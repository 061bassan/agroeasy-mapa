-- Views passam a respeitar o RLS de quem consulta (security_invoker).
-- Sem isso, rodavam com os privilégios do dono e ignoravam private.tem_acesso().
alter view public.inad_perfil_municipio set (security_invoker = true);
alter view public.inad_uf_mensal set (security_invoker = true);
