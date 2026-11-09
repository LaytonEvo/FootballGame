/** Push delivery. Production: Expo push service. Tests/dev: in-memory outbox. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<void>;
}

export class MemoryPushSender implements PushSender {
  readonly sent: (PushMessage & { at?: Date })[] = [];
  async send(messages: PushMessage[]) {
    this.sent.push(...messages);
  }
}

export class ExpoPushSender implements PushSender {
  async send(messages: PushMessage[]) {
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages
        .slice(i, i + 100)
        .map((m) => ({ to: m.token, title: m.title, body: m.body, data: m.data, sound: 'default' }));
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error(`Expo push failed: ${res.status}`);
    }
  }
}
