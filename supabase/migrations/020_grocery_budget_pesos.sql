-- 020: monthly grocery budget as a peso amount (₱1,000 to ₱15,000 in ₱1,000 steps) instead of a range.
-- Nov 18. Asked with a wheel in the 3rd-visit popups. ₱15,000 is shown as "₱15,000+": the top of the wheel
-- covers everyone at or above it. Skipped stays null; there's no "prefer not to say" value, Skip does that.
-- Existing range answers move to the bottom of their range ("Under ₱3,000" becomes ₱2,000); "prefer not to say"
-- becomes null. When this was written, dev had one range answer and prod had none.

alter table public.shopper_profiles add column if not exists grocery_budget_pesos integer
  check (grocery_budget_pesos is null or (grocery_budget_pesos between 1000 and 15000 and grocery_budget_pesos % 1000 = 0));

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'shopper_profiles' and column_name = 'grocery_budget_band') then
    update public.shopper_profiles
       set grocery_budget_pesos = case grocery_budget_band
             when 'under_3000' then 2000 when '3000_5999' then 3000 when '6000_9999' then 6000
             when '10000_14999' then 10000 when '15000_plus' then 15000 end
     where grocery_budget_band is not null and grocery_budget_pesos is null;
    alter table public.shopper_profiles drop column grocery_budget_band;
  end if;
end $$;

grant select (grocery_budget_pesos), insert (grocery_budget_pesos), update (grocery_budget_pesos)
  on public.shopper_profiles to authenticated;
