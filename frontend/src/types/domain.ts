export type Role = 'ADMIN' | 'USER';
export type EventSource = 'FAMILY_HUB' | 'APPLE_CALENDAR';
export type EntityStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export interface User { id:string; telegram_user_id:number; username:string|null; first_name:string; last_name:string|null; avatar_url:string|null; timezone:string; locale:string|null; }
export interface FamilyMember { id:string; role:Role; status:string; joined_at:string|null; user:User; }
export interface Family { id:string; name:string; status:string; my_role:Role; members:FamilyMember[]; }
export interface MeResponse extends User { family:{id:string;name:string;role:Role}|null; }
export interface EventItem { id:string; family_id:string; created_by:string; title:string; description:string|null; start_at:string; end_at:string; timezone:string; location:string|null; responsible_member_id:string; source:EventSource; status:EntityStatus; recurrence_rule:string|null; creator?:User; responsible_member?:FamilyMember; participants?:FamilyMember[]; }
export interface EventPermissions { can_update:boolean; can_delete:boolean; }
export interface EventResponse { data:EventItem; permissions:EventPermissions; }
export interface Reminder { id:string; family_id:string; created_by:string; title:string; description:string|null; scheduled_at:string; timezone:string; responsible_member_id:string; status:EntityStatus; recurrence_rule:string|null; responsible_member?:FamilyMember; }
export interface ListItem { id:string; list_id:string; title:string; is_completed:boolean; created_by:string; position:number; completed_at:string|null; }
export interface FamilyList { id:string; family_id:string; name:string; type:string; created_by:string; items:ListItem[]; }
export interface Note { id:string; family_id:string; created_by:string; title:string; body:string; created_at:string; updated_at:string; }
export interface Idea { id:string; family_id:string; created_by:string; title:string; description:string|null; status:'OPEN'|'DONE'|'ARCHIVED'; author?:User; }
export interface FinanceTransaction { id:string; family_id:string; created_by:string; type:'INCOME'|'EXPENSE'; amount:string; category:string; budget_type:'FIXED'|'FLEXIBLE'|'FUTURE'; description:string|null; occurred_on:string; }
export interface FinanceSummary { income:number; expense:number; balance:number; }

export interface CreditPaymentScheduleItem { from_month:number; to_month:number; amount:string; }
export interface CreditPrepayment { id:string; credit_id:string; created_by:string; amount:string; paid_on:string; comment:string|null; }
export interface Credit { id:string; family_id:string; created_by:string; name:string; principal:string; annual_rate:string; standard_payment:string; term_months:number; payment_schedule:CreditPaymentScheduleItem[]|null; start_date:string; first_payment_date:string; recalculation_mode:'TERM'|'PAYMENT'; status:'ACTIVE'|'CLOSED'; prepayments:CreditPrepayment[]; }
