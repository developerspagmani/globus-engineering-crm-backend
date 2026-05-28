# Data Migration Plan & SQL Queries

This document lists all the tables and SQL queries required to migrate data from the legacy system to the new Globus CRM structure.

> [!WARNING]
> **Important Constraint & Data Integrity Checks:**
> Based on database analysis:
> 1. There are **42 invoices** in `tbl_invoice` with `NULL` or empty `customer_id` / `customer_name`. Since target tables like `app_ledger_entries` require non-null customer keys (`party_id`, `party_name`), direct un-sanitized migration will fail. SQL queries below have been updated to filter out these invalid rows.
> 2. There are **2 price fixing records** in `tbl_item_price_fixing` referencing legacy customer IDs that do not exist. Inner Joins are used to automatically skip these orphans.
> 3. **Ledger Policy Mismatch:** The Express backend (`migrationController.ts`) implements a **Voucher-Only Ledger Policy** where invoices (debits) are *not* logged as ledger entries. If you run both debit (4.1) and credit (4.2 & 4.3) queries, it will create a standard double-entry ledger. Choose the configuration that matches your accounting needs.

---

## 1. Company Setup
Ensure the company exists before running migrations.
```sql
INSERT INTO app_companies (id, name, slug, plan) 
VALUES ('comp_globus', 'Globus Engineering', 'globus-engineering', 'enterprise')
ON DUPLICATE KEY UPDATE name = VALUES(name); -- MySQL 8.0+ Alias: ON DUPLICATE KEY UPDATE name = name;
```

---

## 2. Core Tables Migration

### 2.1 Customers (Update Legacy)
Updates legacy customers with the company identifier.
```sql
UPDATE tbl_customer 
SET company_id = 'comp_globus' 
WHERE company_id IS NULL OR company_id = '';
```

### 2.2 Invoices (Update Legacy)
Updates legacy invoices with the company identifier.
```sql
UPDATE tbl_invoice 
SET company_id = 'comp_globus' 
WHERE company_id IS NULL OR company_id = '';
```

### 2.3 Employees (Update Legacy)
Updates legacy employees with the company identifier.
```sql
UPDATE tbl_employee 
SET company_id = 'comp_globus' 
WHERE company_id IS NULL OR company_id = '';
```

### 2.4 Items (Migrate to App Table)
```sql
INSERT INTO app_items (id, item_code, item_name, company_id, created_at)
SELECT 
    CONCAT('item_', id), 
    COALESCE(NULLIF(item_code, ''), CONCAT('ITM-', id)), 
    item, 
    'comp_globus',
    NOW()
FROM tbl_item 
WHERE item IS NOT NULL AND item != ''
ON DUPLICATE KEY UPDATE item_name = VALUES(item_name);
```

### 2.5 Processes (Migrate to App Table)
```sql
INSERT INTO app_processes (id, process_name, company_id, created_at)
SELECT 
    CONCAT('proc_', id), 
    process, 
    'comp_globus',
    NOW()
FROM tbl_process 
WHERE process IS NOT NULL AND process != ''
ON DUPLICATE KEY UPDATE process_name = VALUES(process_name);
```

### 2.6 Vendors (Migrate to App Table)
*Note: `CAST(land_line AS CHAR)` is used to prevent implicit type mismatch errors with numeric landlines.*
```sql
INSERT INTO app_vendors (id, name, company_id, status, city, phone, created_at)
SELECT 
    CONCAT('vend_', id), 
    customer_name, 
    'comp_globus', 
    'active', 
    city, 
    COALESCE(NULLIF(phone_number1, ''), COALESCE(NULLIF(CAST(land_line AS CHAR), ''), '')),
    NOW()
FROM tbl_vendor 
WHERE customer_name IS NOT NULL AND customer_name != ''
ON DUPLICATE KEY UPDATE name = VALUES(name);
```

### 2.7 Price Fixings (Migrate to App Table)
*Note: `COALESCE` is used on all target non-nullable columns to prevent constraint failures due to potential null fields in source columns.*
```sql
INSERT INTO app_price_fixings (id, customer_id, customer_name, item_id, item_name, process_id, process_name, price, company_id, created_at)
SELECT 
    CONCAT('price_', pf.id),
    CAST(pf.customer_id AS CHAR),
    COALESCE(c.customer_name, 'Unknown Customer'),
    CONCAT('item_', pf.item_id),
    COALESCE(i.item, 'Unknown Item'),
    CONCAT('proc_', pf.process_id),
    COALESCE(p.process, 'Standard'),
    COALESCE(pf.price, 0),
    'comp_globus',
    NOW()
FROM tbl_item_price_fixing pf
JOIN tbl_customer c ON pf.customer_id = c.id
JOIN tbl_item i ON pf.item_id = i.id
JOIN tbl_process p ON pf.process_id = p.id
ON DUPLICATE KEY UPDATE price = VALUES(price);
```

---

## 3. Complex Migrations (Inwards)

### 3.1 Inward Entries
The inward entries require joining multiple tables and formatting items as JSON.
```sql
-- Note: This is handled via backend logic in migrationController.ts (migrateLegacyData)
-- to correctly construct the JSON items from tbl_inward_item and link reference IDs.
```

---

## 4. Financial Synchronization

### 4.1 Ledger Entries (Invoices - Debit)
> [!NOTE]
> Run this query ONLY if you want standard double-entry ledger logging. If you wish to match the application backend's **Voucher-Only** policy, skip this query.
```sql
INSERT INTO app_ledger_entries (id, party_id, party_name, party_type, company_id, date, vch_type, vch_no, type, amount, balance, description, reference_id, created_at)
SELECT 
    UUID(),
    CAST(customer_id AS CHAR),
    customer_name,
    'customer',
    'comp_globus',
    invoice_date,
    'INVOICE',
    CAST(COALESCE(invoice_no, id) AS CHAR),
    'debit',
    COALESCE(CAST(REPLACE(REPLACE(grand_total, ',', ''), ' ', '') AS DECIMAL(15,2)), 0.00),
    0.00, -- Balance is calculated sequentially in app
    CONCAT('Migrated Invoice: ', COALESCE(invoice_no, id)),
    CAST(id AS CHAR),
    COALESCE(app_created_at, NOW())
FROM tbl_invoice
WHERE customer_id IS NOT NULL 
  AND customer_name IS NOT NULL 
  AND customer_name != '';
```

### 4.2 Vouchers (Payments)
Creates vouchers for paid amounts.
```sql
INSERT INTO app_vouchers (id, voucher_no, date, type, party_id, party_name, party_type, company_id, amount, payment_mode, reference_no, status, created_at)
SELECT 
    UUID(),
    CONCAT('M-VCH-', id),
    COALESCE(voucher_date, invoice_date),
    'receipt',
    CAST(customer_id AS CHAR),
    customer_name,
    'customer',
    'comp_globus',
    COALESCE(CAST(REPLACE(REPLACE(paid_amount, ',', ''), ' ', '') AS DECIMAL(15,2)), 0.00),
    CASE WHEN cheque_no IS NOT NULL AND cheque_no != '' THEN 'cheque' ELSE 'cash' END,
    CAST(COALESCE(invoice_no, id) AS CHAR),
    'posted',
    COALESCE(app_created_at, NOW())
FROM tbl_invoice
WHERE customer_id IS NOT NULL 
  AND customer_name IS NOT NULL 
  AND customer_name != ''
  AND COALESCE(CAST(REPLACE(REPLACE(paid_amount, ',', ''), ' ', '') AS DECIMAL(15,2)), 0.00) > 0;
```

### 4.3 Ledger Entries (Receipts - Credit)
Creates ledger credit entries matching the Vouchers created in 4.2.
```sql
INSERT INTO app_ledger_entries (id, party_id, party_name, party_type, company_id, date, vch_type, vch_no, type, amount, balance, description, reference_id, created_at)
SELECT 
    UUID(),
    party_id,
    party_name,
    party_type,
    company_id,
    date,
    'RECEIPT',
    voucher_no,
    'credit',
    amount,
    0.00, -- Balance is calculated sequentially in app
    CONCAT('Migrated Receipt for Inv: ', reference_no),
    id, -- Links to the newly created Voucher ID
    created_at
FROM app_vouchers
WHERE voucher_no LIKE 'M-VCH-%' 
  AND company_id = 'comp_globus';
```

---

## 5. Table Mappings & Unused Tables

| Legacy Table | New Table | Migration Type |
|--------------|-----------|----------------|
| `tbl_customer` | `tbl_customer` | Update (Add `company_id`) |
| `tbl_invoice` | `tbl_invoice` | Update (Add `company_id`, `inward_id`) |
| `tbl_employee` | `tbl_employee` | Update (Add `company_id`) |
| `tbl_item` | `app_items` | Insert New |
| `tbl_process` | `app_processes` | Insert New |
| `tbl_vendor` | `app_vendors` | Insert New |
| `tbl_inward` | `app_inward_entries` | Insert New (JSON items) |
| `tbl_item_price_fixing` | `app_price_fixings` | Insert New |
| N/A | `app_ledger_entries` | Generated from Invoices / Vouchers |
| N/A | `app_vouchers` | Generated from Invoices |

### 5.1 Unused or Unrelated Tables
The following tables exist in the database but are not part of the CRM migration:
-- banner (banner_id, banner_background, image1, image2)
-- daily_plan (daily_plan, country_id, island_id, per_day_amount, image, popular_dive_destination)
-- dive_center (dive_center_id, center_name, address1, address2, city, state, country_id, island_id, contact_person_name, contact_no, email_id, center_image)
-- employee (id, name, gender, photo) -- Note: Distinct from tbl_employee
-- product (product_id, product_name, product_image, price, product_description)
-- special_offer (special_offer_id, offer_image, offer_period, price, starting_place_id, destination_place_id, start_km, note, dive_center_id)
-- tbl_country (country_id, country_name)
-- tbl_courses (id, description)
-- tbl_fundive (id, description)
-- tbl_generalinfo (id, description)
-- tbl_help (id, description)
-- tbl_island (island_id, country_id, island_name)
-- tbl_map (id, lat, lng)
-- tbl_package (id, description)
-- tbl_social_links (id, name, fa_icon_name, links)
-- user (user_id, password, user_type, email, logged_in, last_login, first_name, middle_name, last_name, emp_no) -- Note: Legacy User table
-- tbl_item_1 (id, item, item_code) -- Old version of tbl_item
