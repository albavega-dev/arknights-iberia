import "server-only";

import nodemailer from "nodemailer";

const transport = nodemailer.createTransport({
  host: "127.0.0.1",
  port: 1025,
  secure: false,
  ignoreTLS: true, // Plaintext is acceptable only over the hard-coded local loopback.
  connectionTimeout: 3000,
  greetingTimeout: 3000,
  socketTimeout: 5000,
});

export async function sendLocalAuthEmail(to: string, subject: string, url: string) {
  const link = new URL(url);
  if (link.origin !== "http://localhost:3000") {
    throw new Error("Invalid local authentication link");
  }
  await transport.sendMail({
    from: "Arknights Iberia <no-reply@arknights-iberia.local>",
    to,
    subject,
    text: `Open this local link to continue: ${link.href}`,
  });
}
