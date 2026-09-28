import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import type { OutboundMailer } from "../../../removal-agents/engine/types";

export interface Mailer extends OutboundMailer {
  readonly sent: Array<{ to: string; subject: string; text: string; replyTo?: string }>;
}

/** Log transport: records messages in memory (dev/tests); never prints bodies. */
export class LogMailer implements Mailer {
  readonly sent: Mailer["sent"] = [];
  constructor(private readonly log: (msg: string) => void = () => {}) {}
  async send(msg: { to: string; subject: string; text: string; replyTo?: string }) {
    this.sent.push(msg);
    this.log(`mail queued (log transport): subject="${msg.subject}"`);
    return { messageId: `log-${randomUUID()}` };
  }
}

export class SmtpMailer implements Mailer {
  readonly sent: Mailer["sent"] = [];
  private readonly transport: nodemailer.Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(msg: { to: string; subject: string; text: string; replyTo?: string }) {
    const info = await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, replyTo: msg.replyTo });
    return { messageId: String(info.messageId) };
  }
}
