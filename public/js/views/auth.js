import { ApiError, post } from '../api.js';
import { banner, clear, field, h, showFieldErrors, withBusy } from '../ui.js';

function authShell(container, title, subtitle, ...content) {
  clear(container).append(
    h('main', { class: 'auth-page' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Projetos'),
        h('h1', null, title),
        subtitle ? h('p', { class: 'muted auth-sub' }, subtitle) : null,
        ...content)));
}

// Monta um formulário genérico: valida no servidor, mantém o que foi digitado e mostra erros claros.
function authForm({ fields, submitLabel, busyLabel, onSubmit, extra }) {
  const errorSlot = h('div');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, submitLabel);
  const form = h('form', { class: 'stack', novalidate: true },
    errorSlot, ...Object.values(fields).map((f) => f.wrap), submit, extra);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(errorSlot);
    Object.values(fields).forEach((f) => f.setError(null));
    await withBusy(submit, busyLabel, async () => {
      try {
        await onSubmit(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.control.value])));
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const shown = showFieldErrors(fields, err.fields);
        if (!shown || err.status !== 400) errorSlot.append(banner('error', err.message));
      }
    });
  });
  return form;
}

export function loginView(container, { onAuthenticated, notice }) {
  const fields = {
    email: field({ label: 'E-mail', name: 'email', type: 'email', attrs: { autocomplete: 'email', inputmode: 'email', autofocus: true } }),
    password: field({ label: 'Senha', name: 'password', type: 'password', attrs: { autocomplete: 'current-password' } }),
  };
  authShell(container, 'Entrar', 'Acesse seus projetos e continue de onde parou.',
    notice ? banner('info', notice) : null,
    authForm({
      fields, submitLabel: 'Entrar', busyLabel: 'Entrando…',
      onSubmit: async (v) => onAuthenticated((await post('/auth/login', v)).user),
      extra: h('div', { class: 'auth-links' },
        h('a', { href: '#/recuperar' }, 'Esqueci minha senha'),
        h('span', null, 'Novo por aqui? ', h('a', { href: '#/cadastro' }, 'Criar conta')))
    }));
}

export function registerView(container, { onAuthenticated }) {
  const fields = {
    name: field({ label: 'Nome', name: 'name', attrs: { autocomplete: 'name', autofocus: true } }),
    email: field({ label: 'E-mail', name: 'email', type: 'email', attrs: { autocomplete: 'email', inputmode: 'email' } }),
    password: field({ label: 'Senha', name: 'password', type: 'password', hint: 'Mínimo de 8 caracteres.', attrs: { autocomplete: 'new-password' } }),
  };
  authShell(container, 'Criar conta', 'Leva menos de um minuto. Seus projetos ficam só com você.',
    authForm({
      fields, submitLabel: 'Criar conta', busyLabel: 'Criando conta…',
      onSubmit: async (v) => onAuthenticated((await post('/auth/register', v)).user),
      extra: h('p', { class: 'auth-links' }, h('span', null, 'Já tem conta? ', h('a', { href: '#/entrar' }, 'Entrar'))),
    }));
}

export function forgotView(container) {
  const fields = { email: field({ label: 'E-mail da conta', name: 'email', type: 'email', attrs: { autocomplete: 'email', inputmode: 'email', autofocus: true } }) };
  const sent = h('div', { class: 'stack' });
  authShell(container, 'Recuperar senha', 'Informe o e-mail da conta e enviaremos um link para criar uma nova senha.',
    authForm({
      fields, submitLabel: 'Enviar link', busyLabel: 'Enviando…',
      onSubmit: async (v) => {
        const r = await post('/auth/forgot', v);
        clear(sent).append(
          banner('info', r.message),
          h('p', { class: 'muted' }, 'Não chegou? Confira a caixa de spam ou tente novamente em alguns minutos. O link vale por 1 hora.'),
          h('a', { class: 'btn btn-secondary btn-block', href: '#/entrar' }, 'Voltar para o login'));
      },
      extra: h('p', { class: 'auth-links' }, h('a', { href: '#/entrar' }, 'Voltar para o login')),
    }), sent);
}

export function resetView(container, { token, onDone }) {
  if (!token) {
    authShell(container, 'Link inválido', null,
      banner('error', 'Este link de recuperação está incompleto. Solicite um novo.'),
      h('a', { class: 'btn btn-primary btn-block', href: '#/recuperar' }, 'Solicitar novo link'));
    return;
  }
  const fields = { password: field({ label: 'Nova senha', name: 'password', type: 'password', hint: 'Mínimo de 8 caracteres.', attrs: { autocomplete: 'new-password', autofocus: true } }) };
  const slot = h('div');
  authShell(container, 'Criar nova senha', 'Escolha uma senha nova para a sua conta.',
    authForm({
      fields, submitLabel: 'Salvar nova senha', busyLabel: 'Salvando…',
      onSubmit: async (v) => {
        try {
          await post('/auth/reset', { token, password: v.password });
        } catch (err) {
          if (err instanceof ApiError && err.code === 'invalid_token') {
            clear(slot).append(banner('error', err.message), h('a', { href: '#/recuperar', class: 'btn btn-secondary btn-block' }, 'Solicitar novo link'));
            return;
          }
          throw err;
        }
        onDone('Senha redefinida com sucesso. Entre com a nova senha.');
      },
    }), slot);
}
