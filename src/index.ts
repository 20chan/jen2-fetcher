import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: `.env.local`, override: true });

import Imap from 'node-imap';
import mailparser from 'mailparser';
import cron from 'node-cron';
import fetch from 'node-fetch';
import { writeFile, stat } from 'fs/promises';
import { resolve } from 'path';

const EMAIL_USER = process.env.EMAIL_USER ?? '';
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD ?? '';
const EMAIL_HOST = process.env.EMAIL_HOST ?? '';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT ?? '993');
const EMAIL_USE_TLS = process.env.EMAIL_USE_TLS === 'true';
const JEN2_UPDATE_URL = process.env.JEN2_UPDATE_URL ?? '';

const criteria = [
  ['FROM', 'no-reply@mail.kakaobank.com'],
  ['SUBJECT', '[카카오뱅크] 고객님께서 요청하신 거래내역 엑셀파일입니다'],
];

async function init() {
  const imap = new Imap({
    user: EMAIL_USER,
    password: EMAIL_PASSWORD,
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    tls: EMAIL_USE_TLS,
    keepalive: true,
  });

  return new Promise<Imap>((resolve, reject) => {
    imap.once('error', (err) => {
      reject(err);
    });
    imap.once('ready', () => {
      resolve(imap);
    });
    imap.connect();
  });
}

async function openInbox(imap: Imap): Promise<Imap.Box> {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', true, (err, box) => {
      if (err) {
        reject(err);
      }
      resolve(box);
    });
  });
}

async function search(imap: Imap): Promise<mailparser.ParsedMail[]> {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) {
        reject(err);
      }

      const mails: mailparser.ParsedMail[] = [];
      imap.fetch(results, { bodies: '' })
        .on('message', (msg, seqno) => {
          msg.on('body', (stream, info) => {
            mailparser.simpleParser(stream as any, (err, mail) => {
              if (err) {
                console.error(err);
              }
              else {
                mails.push(mail);
              }

              if (mails.length === results.length) {
                resolve(mails);
              }
            });
          });
        })
    });
  });
}

async function update(mail: mailparser.ParsedMail) {
  const attachment = mail.attachments[0];
  if (!attachment) {
    return;
  }

  const filename = attachment.filename;
  if (!filename) {
    return;
  }

  const path = `data/${filename}`;
  const exists = !!(await stat(path).catch(() => false));
  if (exists) {
    return;
  }

  const content = attachment.content;
  await writeFile(path, content);
  console.log(`[${new Date().toISOString()}] ${filename} saved`);

  const resp = await fetch(JEN2_UPDATE_URL, {
    method: 'POST',
    body: JSON.stringify({
      path: resolve('data'),
    }),
  });

  const { existed, created } = await resp.json() as { existed: number, created: number };
  console.log(`[${new Date().toISOString()}] ${filename} existed: ${existed}, created: ${created}`);
}

async function tick() {
  const imap = await init();
  await openInbox(imap);
  const results = await search(imap);

  for (const result of results) {
    await update(result);
  }
}

cron.schedule('*/1 * * * *', () => {
  tick()
    .then(() => {
      console.log(`[${new Date().toISOString()}] done`);
    })
    .catch((err) => {
      console.error(err);
    });
});