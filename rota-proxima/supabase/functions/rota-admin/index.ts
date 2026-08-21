import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const url = Deno.env.get('SUPABASE_URL')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const createAuthClient = () => createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const send = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers })
const username = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
const emailFor = (user: string) => `${username(user)}@users.rotaproxima.app`
const allowedRoles = ['admin', 'commercial', 'commercial_manager', 'driver', 'production']

async function actor(req: Request) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) return null
  const { data, error } = await admin.auth.getUser(authorization.slice(7))
  if (error || !data.user) return null
  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
  return profile && profile.active ? profile : null
}

async function audit(id: string | null, action: string, entityId: unknown, summary: string, metadata: unknown = {}) {
  await admin.from('audit_logs').insert({
    actor_id: id,
    action,
    entity_type: 'user',
    entity_id: String(entityId || ''),
    summary,
    metadata,
  })
}

async function clearFailures(user: string) {
  await admin.from('login_attempts').delete().eq('username', user).eq('success', false)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'setup-status') {
      const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true })
      return send({ needs_setup: !count })
    }

    if (action === 'setup') {
      const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true })
      if (count) return send({ error: 'O sistema já possui administrador' }, 409)
      const name = String(body.name || '').trim()
      const user = username(body.username)
      const password = String(body.password || '')
      if (!name || user.length < 3 || password.length < 8) {
        return send({ error: 'Informe nome, usuário e senha com pelo menos 8 caracteres' }, 400)
      }
      const authEmail = emailFor(user)
      const { data, error } = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true })
      if (error) throw error
      const { error: profileError } = await admin.from('profiles').insert({
        id: data.user.id,
        name,
        username: user,
        auth_email: authEmail,
        role: 'admin',
        active: true,
        must_change_password: false,
      })
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id)
        throw profileError
      }
      await audit(data.user.id, 'create', data.user.id, 'Administrador inicial criado')
      return send({ ok: true })
    }

    if (action === 'login') {
      const user = username(body.username)
      const password = String(body.password || '')
      if (!user || !password) return send({ error: 'Informe usuário e senha' }, 400)

      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const { data: attempts } = await admin
        .from('login_attempts')
        .select('success,attempted_at')
        .eq('username', user)
        .gte('attempted_at', since)
        .order('attempted_at', { ascending: false })
        .limit(20)
      let failures = 0
      for (const attempt of attempts || []) {
        if (attempt.success) break
        failures += 1
      }
      if (failures >= 5) {
        return send({ error: 'Usuário temporariamente bloqueado. Aguarde 15 minutos e tente novamente.' }, 429)
      }

      const { data: profile } = await admin.from('profiles').select('*').ilike('username', user).maybeSingle()
      if (!profile || !profile.active) {
        await admin.from('login_attempts').insert({
          username: user,
          success: false,
          ip_address: req.headers.get('x-forwarded-for') || '',
        })
        return send({ error: 'Usuário ou senha inválidos' }, 401)
      }

      // A Edge Function pode atender vários celulares no mesmo isolate. Um cliente
      // novo por login impede que a sessão em memória de um usuário seja reutilizada.
      const { data, error } = await createAuthClient().auth.signInWithPassword({
        email: profile.auth_email,
        password,
      })
      await admin.from('login_attempts').insert({
        username: user,
        success: !error,
        ip_address: req.headers.get('x-forwarded-for') || '',
      })
      if (error || !data.session) return send({ error: 'Usuário ou senha inválidos' }, 401)

      await admin.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', profile.id)
      await audit(profile.id, 'login', profile.id, 'Login realizado')
      return send({
        user: profile,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      })
    }

    const currentActor = await actor(req)
    if (!currentActor) return send({ error: 'Sessão inválida ou usuário inativo' }, 401)

    if (action === 'change-own-password') {
      const current = String(body.current_password || '')
      const next = String(body.new_password || '')
      if (next.length < 8) return send({ error: 'A nova senha deve ter pelo menos 8 caracteres' }, 400)
      const { error: verifyError } = await createAuthClient().auth.signInWithPassword({
        email: currentActor.auth_email,
        password: current,
      })
      if (verifyError) return send({ error: 'Senha atual incorreta' }, 401)
      const { error } = await admin.auth.admin.updateUserById(currentActor.id, { password: next })
      if (error) throw error
      await admin.from('profiles').update({ must_change_password: false }).eq('id', currentActor.id)
      await clearFailures(currentActor.username)
      await audit(currentActor.id, 'password_change', currentActor.id, 'Senha própria alterada')
      return send({ ok: true })
    }

    if (currentActor.role !== 'admin') return send({ error: 'Sem permissão' }, 403)

    if (action === 'create-user') {
      const name = String(body.name || '').trim()
      const user = username(body.username)
      const password = String(body.password || '')
      const role = String(body.role || '')
      const phone = String(body.phone || '').trim()
      if (!name || user.length < 3 || password.length < 8 || !allowedRoles.includes(role)) {
        return send({ error: 'Dados de usuário inválidos' }, 400)
      }
      const { data: duplicate } = await admin.from('profiles').select('id').ilike('username', user).maybeSingle()
      if (duplicate) return send({ error: 'Usuário já existe' }, 409)

      const authEmail = emailFor(user)
      const { data, error } = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true })
      if (error) throw error
      const profile = {
        id: data.user.id,
        name,
        username: user,
        auth_email: authEmail,
        role,
        phone,
        active: true,
        must_change_password: true,
      }
      const { error: profileError } = await admin.from('profiles').insert(profile)
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id)
        throw profileError
      }
      await audit(currentActor.id, 'create', data.user.id, `Usuário ${name} criado`)
      return send({ ok: true, id: data.user.id })
    }

    if (action === 'reset-password') {
      const id = String(body.user_id || '')
      const password = String(body.password || '')
      if (!id || password.length < 8) return send({ error: 'Nova senha deve ter pelo menos 8 caracteres' }, 400)
      const { data: target } = await admin.from('profiles').select('username').eq('id', id).maybeSingle()
      if (!target) return send({ error: 'Usuário não encontrado' }, 404)
      const { error } = await admin.auth.admin.updateUserById(id, { password })
      if (error) throw error
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id)
      await clearFailures(target.username)
      await audit(currentActor.id, 'password_reset', id, 'Senha redefinida pelo administrador')
      return send({ ok: true })
    }

    if (action === 'delete-user') {
      const id = String(body.user_id || '')
      if (!id || id === currentActor.id) {
        return send({ error: 'Não é possível excluir esta conta' }, 400)
      }
      const [{ count: routeCount }, { count: requestCount }] = await Promise.all([
        admin
          .from('routes')
          .select('*', { count: 'exact', head: true })
          .or(`driver_id.eq.${id},created_by.eq.${id}`),
        admin
          .from('scheduling_requests')
          .select('*', { count: 'exact', head: true })
          .eq('requested_by', id),
      ])
      if ((routeCount || 0) + (requestCount || 0) > 0) {
        return send({ error: 'Usuário possui histórico. Desative em vez de excluir.' }, 409)
      }
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) throw error
      await audit(currentActor.id, 'delete', id, 'Usuário excluído definitivamente')
      return send({ ok: true })
    }

    if (action === 'force-signout') {
      return send({ error: 'Esta ação não está habilitada nesta versão.' }, 501)
    }

    return send({ error: 'Ação não encontrada' }, 404)
  } catch (error) {
    console.error(error)
    return send({ error: error instanceof Error ? error.message : 'Erro interno' }, 500)
  }
})
