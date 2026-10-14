-- =====================================================================
-- Cadastro aberto para e-mails @agroeasy.com.br (com confirmação por e-mail)
-- - Só aceita criar conta com e-mail do domínio (ou exceções em private.acessos)
-- - Acesso aos dados: e-mail do domínio CONFIRMADO, ou exceção ativa em private.acessos
-- - Para bloquear alguém do domínio: insira o e-mail em private.acessos com ativo = false
-- =====================================================================

create or replace function private.tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with u as (
    select lower(coalesce((select auth.jwt()) ->> 'email', '')) as email
  )
  select
    -- bloqueio explícito tem prioridade
    not exists (select 1 from private.acessos a, u where a.email = u.email and not a.ativo)
    and (
      -- exceção liberada manualmente
      exists (select 1 from private.acessos a, u where a.email = u.email and a.ativo)
      -- ou e-mail do domínio já confirmado
      or (
        (select email from u) like '%@agroeasy.com.br'
        and exists (
          select 1 from auth.users x
          where x.id = (select auth.uid()) and x.email_confirmed_at is not null
        )
      )
    );
$$;
revoke all on function private.tem_acesso() from public, anon;
grant execute on function private.tem_acesso() to authenticated;

-- Recusa contas (ou troca de e-mail) fora do domínio, salvo exceções liberadas
create or replace function private.validar_dominio_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or (lower(new.email) not like '%@agroeasy.com.br'
         and not exists (select 1 from private.acessos a where a.email = lower(new.email) and a.ativo)) then
    raise exception 'Cadastro permitido apenas para e-mails @agroeasy.com.br'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.validar_dominio_usuario() from public, anon, authenticated;

drop trigger if exists validar_dominio_usuario on auth.users;
create trigger validar_dominio_usuario
  before insert or update of email on auth.users
  for each row execute function private.validar_dominio_usuario();
