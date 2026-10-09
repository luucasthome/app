import nodemailer from 'nodemailer';

// Sem SMTP_URL, o e-mail é apenas registrado no log (modo desenvolvimento).
export function createMailer(config) {
  let transport = null;
  return {
    async send({ to, subject, text }) {
      if (!config.smtpUrl) {
        console.log(`\n[e-mail simulado] Para: ${to}\nAssunto: ${subject}\n${text}\n`);
        return;
      }
      transport ??= nodemailer.createTransport(config.smtpUrl);
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
    },
  };
}
