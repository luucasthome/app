// Uso: npm run usuario -- <nome> <senha>   (cria ou troca a senha)
import { abrirBanco } from '../src/db.js';
import { hashSenha } from '../src/auth.js';

const [nome, senha] = process.argv.slice(2);
if (!nome || !senha || senha.length < 8) {
  console.error('Uso: npm run usuario -- <nome> <senha com 8+ caracteres>');
  process.exit(1);
}
const db = abrirBanco();
db.prepare('INSERT INTO usuarios (nome, hash, criadoEm) VALUES (?,?,?) ON CONFLICT(nome) DO UPDATE SET hash = excluded.hash').run(nome.trim(), hashSenha(senha), new Date().toISOString());
console.log(`Usuário "${nome.trim()}" salvo.`);
