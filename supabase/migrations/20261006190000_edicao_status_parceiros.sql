-- Status de parceiros editável somente por contas provisionadas.
-- A tabela de editores fica no schema privado; o frontend nunca escreve
-- diretamente em public.parceiros.

-- A migration só segue se a chave natural não tiver colisões e as duas contas
-- informadas existirem com e-mail confirmado (requisito de acesso do projeto).
do $$
begin
  if exists (
    select 1 from public.parceiros
    group by nome, municipio, uf
    having count(*) > 1
  ) then
    raise exception 'Há parceiros duplicados por nome, município e UF; resolva as duplicatas antes da migration.';
  end if;

  if (
    select count(distinct lower(email))
    from auth.users
    where lower(email) in ('editor1@exemplo.com.br', 'editor2@exemplo.com.br')
      and email_confirmed_at is not null
  ) <> 2 then
    raise exception 'As duas contas editoras precisam existir e estar confirmadas antes da migration.';
  end if;
end;
$$;

create table if not exists private.parceiro_editores (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%._%'),
  criado_em timestamptz not null default now()
);
revoke all on private.parceiro_editores from public, anon, authenticated;

-- Chave natural estável para o seed atualizar a ordem sem substituir status/IDs.
create unique index if not exists parceiros_nome_municipio_uf_key
  on public.parceiros (nome, municipio, uf);

create table if not exists private.parceiro_status_historico (
  id bigint generated always as identity primary key,
  parceiro_id bigint not null references public.parceiros(id) on delete restrict,
  ator uuid not null references auth.users(id) on delete restrict,
  status_anterior text not null check (status_anterior in ('Ativo', 'Inativo')),
  status_novo text not null check (status_novo in ('Ativo', 'Inativo')),
  alterado_em timestamptz not null default now()
);
revoke all on private.parceiro_status_historico from public, anon, authenticated;

create or replace function public.pode_editar_parceiros()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.tem_acesso()), false)
    and exists (
      select 1
      from private.parceiro_editores e
      where e.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    );
$$;
revoke all on function public.pode_editar_parceiros() from public, anon;
grant execute on function public.pode_editar_parceiros() to authenticated;

create or replace function public.alterar_status_parceiro(
  p_id bigint,
  p_status text,
  p_status_esperado text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parceiro public.parceiros%rowtype;
begin
  if not coalesce((select public.pode_editar_parceiros()), false) then
    raise exception 'Você não tem permissão para alterar parceiros.' using errcode = '42501';
  end if;

  if p_status not in ('Ativo', 'Inativo') or p_status_esperado not in ('Ativo', 'Inativo') then
    raise exception 'Status de parceiro inválido.' using errcode = '22023';
  end if;

  select * into v_parceiro
  from public.parceiros
  where id = p_id
  for update;

  if not found then
    raise exception 'Parceiro não encontrado.' using errcode = 'P0002';
  end if;

  -- Repetição segura: se o status solicitado já estiver aplicado, não duplica auditoria.
  if v_parceiro.status = p_status then
    return jsonb_build_object('id', v_parceiro.id, 'status', v_parceiro.status, 'alterado', false);
  end if;

  if v_parceiro.status is distinct from p_status_esperado then
    raise exception 'O status deste parceiro mudou. Atualize a tela e tente novamente.' using errcode = '40001';
  end if;

  update public.parceiros
  set status = p_status
  where id = p_id;

  insert into private.parceiro_status_historico
    (parceiro_id, ator, status_anterior, status_novo)
  values
    (v_parceiro.id, (select auth.uid()), v_parceiro.status, p_status);

  return jsonb_build_object('id', v_parceiro.id, 'status', p_status, 'alterado', true);
end;
$$;
revoke all on function public.alterar_status_parceiro(bigint, text, text) from public, anon;
grant execute on function public.alterar_status_parceiro(bigint, text, text) to authenticated;

-- Editores iniciais: troque os e-mails de exemplo pelos das contas editoras reais antes de aplicar.
insert into private.parceiro_editores (email) values
  ('editor1@exemplo.com.br'),
  ('editor2@exemplo.com.br')
on conflict (email) do nothing;
