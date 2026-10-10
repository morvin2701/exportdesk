/** Default settings shared by the settings API and invoice numbering. */
module.exports = {
  company: {
    name: '', tagline: '', legalName: '', address: '', city: '', country: '', phone: '', altPhone: '', email: '', website: '',
    iec: '', taxLabel: 'TRN / GSTIN', taxId: '', pan: '', regNo: '',
  },
  branding: { logo: '', stamp: '', signature: '', signatoryName: '', signatoryTitle: 'Authorised Signatory', accent: '#0f766e', template: 'modern' },
  numbering: { prefix: 'EXP-INV', yearInNumber: true, padding: 4, startFrom: 1 },
  defaults: {
    currency: 'USD', incoterm: 'FOB', paymentTerms: '100% advance by T/T before shipment', dueDays: 30,
    countryOfOrigin: '', portOfLoading: '', transportMode: 'Sea', taxLabel: 'VAT', taxRate: 0, unit: 'PCS',
    declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    notes: '',
  },
  banks: [],
  terms: { lines: ['Goods once sold will not be taken back.', 'Interest @ 18% p.a. will be charged if payment is delayed beyond the due date.', 'Subject to our jurisdiction only.'] },
};
