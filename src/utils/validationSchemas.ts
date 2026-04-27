
export interface ValidationRule {
  required?: boolean;
  type?: 'email' | 'phone' | 'number' | 'date' | 'string';
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  message?: string;
}

export interface Schema {
  [key: string]: ValidationRule;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_REGEX = /^\d{10}$/; // Exactly 10 digits

export const customerSchema: Schema = {
  name: { required: true, message: 'Customer Name is required' },
  email: { required: true, message: 'Email is required' },
  phone: { required: true, message: 'Phone Number is required' },
  street1: { required: true, message: 'Address (Street 1) is required' },
  city: { required: true, message: 'City is required' },
  state: { required: true, message: 'State is required' },
  pinCode: { required: true, message: 'Pin Code is required' },
  stateCode: { required: true, message: 'State Code is required' },
  gst: { required: true, message: 'GST Number is required' },
  contactPerson1: { required: true, message: 'Contact Person 1 is required' },
  emailId1: { required: true, message: 'Contact Person Email 1 is required' },
  phoneNumber1: { required: true, message: 'Contact Person Phone 1 is required' },
};


export const vendorSchema: Schema = {
  name: { required: true, message: 'Vendor Name is required' },
  email: { required: true, message: 'Email is required' },
  phone: { required: true, message: 'Phone Number is required' },
  street1: { required: true, message: 'Address (Street 1) is required' },
  city: { required: true, message: 'City is required' },
  state: { required: true, message: 'State is required' },
  gst: { required: true, message: 'GST Number is required' },
  contactPerson1: { required: true, message: 'Contact Person 1 is required' },
  emailId1: { required: true, message: 'Contact Person Email 1 is required' },
  phoneNumber1: { required: true, message: 'Contact Person Phone 1 is required' },
};


export const invoiceSchema: Schema = {
  invoice_date: { required: true, type: 'date', message: 'Invoice Date is required' },
  customer_id: { required: true, message: 'Customer is required' },
  items: { required: true, message: 'Item details are required' },
  grand_total: { required: true, message: 'Total Amount is required' },
  tax_rate: { required: true, type: 'number', message: 'Tax Rate is required' },
};

export const companySchema: Schema = {
  name: { required: true, message: 'Core Company Name is required' },
  slug: { required: true, message: 'Company URL Slug is required' },
  companyName: { required: true, message: 'Invoice Header Company Name is required' },
  companyAddress: { required: true, message: 'Supplier Address is required' },
  gstNo: { required: true, message: 'GST Number is required' },
  panNo: { required: true, message: 'PAN Number is required' },
  bankName: { required: true, message: 'Bank Name is required' },
  bankAcc: { required: true, message: 'Bank Account Number is required' },
  bankBranchIfsc: { required: true, message: 'Branch & IFSC is required' },
};


export const inwardSchema: Schema = {
  date: { required: true, type: 'date', message: 'Date is required' },
  customer_id: { required: true, message: 'Customer is required' },
  inward_no: { required: true, message: 'Inward Number is required' },
  due_date: { required: true, type: 'date', message: 'Due Date is required' },
  items: { required: true, message: 'Item details are required' },
};


export const outwardSchema: Schema = {
  date: { required: true, type: 'date', message: 'Date is required' },
  outward_no: { required: true, message: 'Outward/Challan Number is required' },
  vehicle_no: { required: true, message: 'Vehicle Number is required' },
  items: { required: true, message: 'Item details are required' },
};


export const itemSchema: Schema = {
  itemName: { required: true, message: 'Item Name is required' },
  itemCode: { required: true, message: 'Item Code is required' },
};

export const employeeSchema: Schema = {
  name: { required: true, message: 'Full Name is required' },
  email: { required: true, message: 'Email is required' },
  phone: { required: true, message: 'Phone is required' },
  designation: { required: true, message: 'Designation is required' },
  salary: { required: true, type: 'number', message: 'Salary is required' },
  joiningDate: { required: true, type: 'date', message: 'Joining Date is required' },
};


export const processSchema: Schema = {
  processName: { required: true, message: 'Process Name is required' },
};

export const leadSchema: Schema = {
  name: { required: true, message: 'Prospect Name is required' },
  company: { required: true, message: 'Company Name is required' },
  email: { required: true, message: 'Email is required' },
  phone: { required: true, message: 'Phone is required' },
  assigned_area: { required: true, message: 'Geographic Area is required' },
};


export const priceFixingSchema: Schema = {
  customerId: { required: true, message: 'Customer is required' },
  itemId: { required: true, message: 'Item is required' },
  processId: { required: true, message: 'Process is required' },
  price: { required: true, type: 'number', message: 'Price is required' },
};

export const storeSchema: Schema = {
  name: { required: true, message: 'Store Name is required' },
  owner_name: { required: true, message: 'Owner Name is required' },
  phone: { required: true, message: 'Phone is required' },
  address: { required: true, message: 'Address is required' },
};

export const storeVisitSchema: Schema = {
  store_id: { required: true, message: 'Store is required' },
  visit_date: { required: true, type: 'date', message: 'Visit Date is required' },
};

export const voucherSchema: Schema = {
  date: { required: true, type: 'date', message: 'Voucher Date is required' },
  party_id: { required: true, message: 'Party (Customer/Vendor) is required' },
  amount: { required: true, type: 'number', message: 'Amount is required' },
  payment_mode: { required: true, message: 'Payment Mode is required' },
};


export const challanSchema: Schema = {
  challan_no: { required: true, message: 'Challan Number is required' },
  party_name: { required: true, message: 'Party Name is required' },
  items: { required: true, message: 'Item details are required' },
};


export const validateData = (data: any, schema: Schema) => {
  const errors: { [key: string]: string } = {};

  for (const field in schema) {
    const rule = schema[field];
    const value = data[field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors[field] = rule.message || `${field} is required`;
      continue;
    }

    if (value) {
      if (rule.type === 'email' && !EMAIL_REGEX.test(value)) {
        errors[field] = 'Invalid email format';
      } else if (rule.type === 'phone' && !PHONE_REGEX.test(value.toString().replace(/\D/g, ''))) {
        errors[field] = 'Phone number must be 10 digits';
      } else if (rule.type === 'number' && isNaN(Number(value))) {
        errors[field] = 'Must be a valid number';
      } else if (rule.type === 'date' && isNaN(Date.parse(value))) {
        errors[field] = 'Invalid date format';
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};
