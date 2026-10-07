-- Smart Trip Builder: how much each place matters, and (optionally) how long the traveller wants to spend there.
--   priority: must (never dropped by the planner) · high · normal · optional ("maybe")
--   visit_minutes: the traveller's own time at the place; null = use the category's usual time
alter table public.places add column if not exists priority text not null default 'normal';
alter table public.places drop constraint if exists places_priority_valid;
alter table public.places add constraint places_priority_valid check (priority in ('must', 'high', 'normal', 'optional'));

alter table public.places add column if not exists visit_minutes smallint;
alter table public.places drop constraint if exists places_visit_minutes_valid;
alter table public.places add constraint places_visit_minutes_valid check (visit_minutes is null or visit_minutes between 10 and 720);
