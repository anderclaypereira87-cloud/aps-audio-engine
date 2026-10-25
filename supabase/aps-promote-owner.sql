-- APS ONLY. Execute manually inside the verified APS project.
-- First sign up as anderclay.pereira87@gmail.com and confirm the e-mail.
-- Fails safely if exactly one verified account is not found.
do $$
declare owner_id uuid;
begin
  select id into strict owner_id
  from auth.users
  where lower(email) = lower('anderclay.pereira87@gmail.com')
    and email_confirmed_at is not null;
  update public.profiles set role = 'admin' where id = owner_id;
  if not found then
    raise exception 'Verified APS owner exists in auth.users but has no profile';
  end if;
end;
$$;
