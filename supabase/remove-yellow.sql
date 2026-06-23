-- Remove Yellow packages (same as MTN) and consolidate orders

delete from public.data_packages where network = 'yellow';
update public.orders set network = 'mtn' where network in ('yellow', 'yello');

alter table public.data_packages drop constraint if exists data_packages_network_check;
alter table public.data_packages add constraint data_packages_network_check
  check (network in ('mtn', 'at_ishare', 'at_bigtime', 'telecel'));
