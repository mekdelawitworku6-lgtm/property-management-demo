import { Language } from '@prisma/client';

/**
 * Bilingual (English / Amharic) message catalogue for notifications, SMS and reports.
 * Placeholders use {name} syntax and are filled by `translate()`.
 */
export const MESSAGES = {
  RENT_DUE: {
    EN: { title: 'Rent due', body: 'Your rent of {amount} ETB for {unit} is due on {dueDate}.' },
    AM: { title: 'የኪራይ ክፍያ ቀን', body: 'ለ{unit} የ{amount} ብር ኪራይ ክፍያ በ{dueDate} ይጠበቃል።' },
  },
  RENT_OVERDUE: {
    EN: { title: 'Rent overdue', body: 'Your rent of {amount} ETB for {unit} was due on {dueDate}. Please pay now.' },
    AM: { title: 'ያለፈ የኪራይ ክፍያ', body: 'ለ{unit} የ{amount} ብር ኪራይ በ{dueDate} መከፈል ነበረበት። እባክዎ አሁን ይክፈሉ።' },
  },
  PAYMENT_RECEIVED: {
    EN: { title: 'Payment received', body: 'Payment of {amount} ETB (ref {reference}) has been confirmed.' },
    AM: { title: 'ክፍያ ተቀብለናል', body: 'የ{amount} ብር ክፍያ (ማጣቀሻ {reference}) ተረጋግጧል።' },
  },
  PAYMENT_REJECTED: {
    EN: { title: 'Payment rejected', body: 'Payment ref {reference} was rejected: {reason}.' },
    AM: { title: 'ክፍያ ውድቅ ሆኗል', body: 'የክፍያ ማጣቀሻ {reference} ውድቅ ተደርጓል፦ {reason}።' },
  },
  RENTAL_REQUEST_NEW: {
    EN: { title: 'New rental request', body: '{tenant} requested to rent {unit}.' },
    AM: { title: 'አዲስ የኪራይ ጥያቄ', body: '{tenant} {unit}ን ለመከራየት ጠይቀዋል።' },
  },
  RENTAL_REQUEST_ACCEPTED: {
    EN: { title: 'Rental request accepted', body: 'Your request for {unit} was accepted. Please sign the agreement.' },
    AM: { title: 'የኪራይ ጥያቄዎ ተቀባይነት አግኝቷል', body: 'ለ{unit} ያቀረቡት ጥያቄ ተቀባይነት አግኝቷል። እባክዎ ውሉን ይፈርሙ።' },
  },
  RENTAL_REQUEST_REJECTED: {
    EN: { title: 'Rental request declined', body: 'Your request for {unit} was declined.' },
    AM: { title: 'የኪራይ ጥያቄዎ ውድቅ ሆኗል', body: 'ለ{unit} ያቀረቡት ጥያቄ ውድቅ ተደርጓል።' },
  },
  AGREEMENT_READY: {
    EN: { title: 'Agreement ready to sign', body: 'Rental agreement {reference} is ready for your signature.' },
    AM: { title: 'ውሉ ለፊርማ ዝግጁ ነው', body: 'የኪራይ ውል {reference} ለፊርማዎ ዝግጁ ነው።' },
  },
  AGREEMENT_SIGNED: {
    EN: { title: 'Agreement signed', body: 'Agreement {reference} for {unit} has been signed by {tenant}.' },
    AM: { title: 'ውሉ ተፈርሟል', body: 'ለ{unit} የተዘጋጀው ውል {reference} በ{tenant} ተፈርሟል።' },
  },
  AGREEMENT_TERMINATED: {
    EN: { title: 'Agreement terminated', body: 'Agreement {reference} has been terminated.' },
    AM: { title: 'ውሉ ተቋርጧል', body: 'ውል {reference} ተቋርጧል።' },
  },
  LEASE_EXPIRING: {
    EN: { title: 'Lease expiring soon', body: 'Agreement {reference} for {unit} expires on {endDate}.' },
    AM: { title: 'ውሉ በቅርቡ ያበቃል', body: 'ለ{unit} የተደረገው ውል {reference} በ{endDate} ያበቃል።' },
  },
  COMPLAINT_NEW: {
    EN: { title: 'New complaint', body: 'New {category} report for {unit}: {title}' },
    AM: { title: 'አዲስ ቅሬታ', body: 'ለ{unit} አዲስ የ{category} ሪፖርት፦ {title}' },
  },
  COMPLAINT_UPDATED: {
    EN: { title: 'Complaint updated', body: 'Complaint {reference} is now {status}.' },
    AM: { title: 'ቅሬታው ተሻሽሏል', body: 'ቅሬታ {reference} አሁን {status} ነው።' },
  },
  COMPLAINT_RESPONSE: {
    EN: { title: 'New reply on complaint', body: 'There is a new reply on complaint {reference}.' },
    AM: { title: 'በቅሬታው ላይ አዲስ ምላሽ', body: 'በቅሬታ {reference} ላይ አዲስ ምላሽ አለ።' },
  },
  COMPLAINT_ESCALATED: {
    EN: { title: 'Complaint escalated', body: 'Complaint {reference} has been escalated to the platform admin.' },
    AM: { title: 'ቅሬታው ወደ አስተዳዳሪ ተላልፏል', body: 'ቅሬታ {reference} ወደ ፕላትፎርም አስተዳዳሪ ተላልፏል።' },
  },
  WORK_ORDER_UPDATED: {
    EN: { title: 'Maintenance update', body: 'Work order {reference} is now {status}.' },
    AM: { title: 'የጥገና ሁኔታ', body: 'የሥራ ትዕዛዝ {reference} አሁን {status} ነው።' },
  },
  ACCOUNT_APPROVED: {
    EN: { title: 'Account approved', body: 'Your account has been approved. Welcome!' },
    AM: { title: 'መለያዎ ጸድቋል', body: 'መለያዎ ጸድቋል። እንኳን ደህና መጡ!' },
  },
  ACCOUNT_SUSPENDED: {
    EN: { title: 'Account suspended', body: 'Your account has been suspended: {reason}' },
    AM: { title: 'መለያዎ ታግዷል', body: 'መለያዎ ታግዷል፦ {reason}' },
  },
  OTP: {
    EN: { title: 'Verification code', body: 'Your verification code is {code}. It expires in {minutes} minutes.' },
    AM: { title: 'የማረጋገጫ ኮድ', body: 'የማረጋገጫ ኮድዎ {code} ነው። በ{minutes} ደቂቃ ውስጥ ያበቃል።' },
  },
} as const;

export type MessageKey = keyof typeof MESSAGES;

export function fillTemplate(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] === undefined || params[key] === null ? `{${key}}` : String(params[key]),
  );
}

export function translate(
  key: MessageKey,
  language: Language | string = Language.EN,
  params: Record<string, unknown> = {},
): { title: string; body: string } {
  const entry = MESSAGES[key];
  const lang = language === Language.AM ? 'AM' : 'EN';
  const localized = entry[lang] ?? entry.EN;
  return { title: fillTemplate(localized.title, params), body: fillTemplate(localized.body, params) };
}

/** Report labels (exports & statements). */
export const REPORT_LABELS = {
  EN: {
    ownerStatement: 'Owner Monthly Statement',
    paymentsReport: 'Payments Report',
    rentRoll: 'Rent Roll',
    period: 'Period',
    owner: 'Owner',
    income: 'Income',
    expenses: 'Expenses',
    net: 'Net',
    property: 'Property',
    unit: 'Unit',
    tenant: 'Tenant',
    amount: 'Amount',
    method: 'Method',
    status: 'Status',
    date: 'Date',
    reference: 'Reference',
    category: 'Category',
    description: 'Description',
    rent: 'Rent',
    outstanding: 'Outstanding',
    leaseEnd: 'Lease end',
    generatedAt: 'Generated at',
  },
  AM: {
    ownerStatement: 'የባለቤት ወርሃዊ መግለጫ',
    paymentsReport: 'የክፍያዎች ሪፖርት',
    rentRoll: 'የኪራይ ዝርዝር',
    period: 'ጊዜ',
    owner: 'ባለቤት',
    income: 'ገቢ',
    expenses: 'ወጪዎች',
    net: 'የተጣራ',
    property: 'ንብረት',
    unit: 'ክፍል',
    tenant: 'ተከራይ',
    amount: 'መጠን',
    method: 'ዘዴ',
    status: 'ሁኔታ',
    date: 'ቀን',
    reference: 'ማጣቀሻ',
    category: 'ምድብ',
    description: 'መግለጫ',
    rent: 'ኪራይ',
    outstanding: 'ያልተከፈለ',
    leaseEnd: 'ውል የሚያበቃበት',
    generatedAt: 'የተዘጋጀበት',
  },
} as const;

export type ReportLabels = { [K in keyof (typeof REPORT_LABELS)['EN']]: string };

export function reportLabels(language: Language | string): ReportLabels {
  return language === Language.AM ? REPORT_LABELS.AM : REPORT_LABELS.EN;
}
