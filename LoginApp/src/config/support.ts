import {SUPPORT_PHONE_NUMBER, SUPPORT_WHATSAPP_NUMBER, SUPPORT_EMAIL_ADDRESS} from '@env';
export const SUPPORT_EMAIL = SUPPORT_EMAIL_ADDRESS?.trim() || 'admin@plugorbit.com';
export const SUPPORT_PHONE = SUPPORT_PHONE_NUMBER?.trim() || '';
const whatsapp = SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, '') || '';
export const SUPPORT_WHATSAPP_URL = whatsapp ? `https://wa.me/${whatsapp}` : '';
