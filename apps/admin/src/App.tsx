import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { admin, getToken, setToken } from './api';

type Tab = 'gameweeks' | 'players' | 'clubs' | 'users' | 'packs' | 'config' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gameweeks', label: 'Gameweeks & matches' },
  { id: 'players', label: 'Players & transfers' },
  { id: 'clubs', label: 'Clubs' },
  { id: 'users', label: 'Users & ledger' },
  { id: 'packs', label: 'Pack log' },
  { id: 'config', label: 'Points & economy' },
  { id: 'audit', label: 'Audit' },
];

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await admin<T>(path));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, err, reload: load };
}

/** Runs an action with a confirm prompt and a reason where the API needs one, then shows the result. */
function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    if (!confirm(`${label}?`)) return;
    try {
      const r = await fn();
      setMsg({ ok: true, text: `${label}: ${JSON.stringify(r)}` });
      after?.();
    } catch (e) {
      setMsg({ ok: false, text: `${label} failed: ${(e as Error).message}` });
    }
  };
  const view: ReactNode = msg ? <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p> : null;
  return { run, view };
}

interface Gameweek {
  id: string;
  number: number;
  status: string;
  deadlineAt: string;
  finaliseAt: string;
  scoringVersion: string | null;
}
interface Fixture {
  id: string;
  home: string;
  away: string;
  kickoffAt: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  voided: boolean;
}

function Gameweeks() {
  const gws = useLoad<Gameweek[]>('/admin/gameweeks');
  const [sel, setSel] = useState<string | null>(null);
  const fx = useLoad<Fixture[]>(sel ? `/admin/gameweeks/${sel}/fixtures` : null);
  const { run, view } = useAction();
  const reason = () => prompt('Reason (kept in the audit log)') ?? '';
  return (
    <>
      <section>
        <h2>Gameweeks</h2>
        {gws.err ? <p className="err">{gws.err}</p> : null}
        <table>
          <thead>
            <tr>
              <th>GW</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Finalises</th>
              <th>Scoring</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(gws.data ?? []).map((g) => (
              <tr key={g.id}>
                <td>{g.number}</td>
                <td>{g.status}</td>
                <td>{new Date(g.deadlineAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</td>
                <td>{new Date(g.finaliseAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</td>
                <td>{g.scoringVersion ?? '—'}</td>
                <td className="row">
                  <button className="act secondary" onClick={() => setSel(g.id)}>
                    Matches
                  </button>
                  {['locked', 'live', 'provisional'].includes(g.status) ? (
                    <button
                      className="act secondary"
                      onClick={() =>
                        run(`Re-score GW${g.number}`, () =>
                          admin(`/admin/gameweeks/${g.id}/rescore`, { body: {} }),
                        )
                      }
                    >
                      Re-score
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {sel ? (
        <section>
          <h2>Matches</h2>
          <p className="muted">
            Void: every action on that match's players is voided and the sub rule applies. Not possible after
            09:00 finalisation.
          </p>
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th>Kick-off</th>
                <th>Status</th>
                <th>Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(fx.data ?? []).map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.home} v {f.away}
                    {f.voided ? ' (VOID)' : ''}
                  </td>
                  <td>
                    {f.kickoffAt
                      ? new Date(f.kickoffAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })
                      : 'TBC'}
                  </td>
                  <td>{f.status}</td>
                  <td>
                    {f.homeScore ?? '–'}–{f.awayScore ?? '–'}
                  </td>
                  <td className="row">
                    <button
                      className={`act ${f.voided ? 'secondary' : 'danger'}`}
                      onClick={() =>
                        run(
                          `${f.voided ? 'Un-void' : 'Void'} ${f.home} v ${f.away}`,
                          () =>
                            admin(`/admin/fixtures/${f.id}/void`, {
                              body: { voided: !f.voided, reason: reason() },
                            }),
                          fx.reload,
                        )
                      }
                    >
                      {f.voided ? 'Un-void' : 'Void'}
                    </button>
                    <button
                      className="act secondary"
                      onClick={() =>
                        run(
                          `Mark ${f.home} v ${f.away} postponed`,
                          () =>
                            admin(`/admin/fixtures/${f.id}/status`, {
                              body: { status: 'postponed', reason: reason() },
                            }),
                          fx.reload,
                        )
                      }
                    >
                      Postponed
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {view}
    </>
  );
}

interface ClubRow {
  id: string;
  code: string;
  name: string;
  inLeague: boolean;
}
interface PlayerRow {
  player: {
    id: string;
    name: string;
    position: string;
    rating: number;
    status: string;
    clubId: string | null;
  };
  clubCode: string | null;
}

function Players() {
  const [q, setQ] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const res = useLoad<PlayerRow[]>(path);
  const clubs = useLoad<ClubRow[]>('/admin/clubs');
  const moves = useLoad<unknown[]>('/admin/moves');
  const { run, view } = useAction();
  return (
    <>
      <section>
        <h2>Find a player</h2>
        <div className="row">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
          <button className="act" onClick={() => setPath(`/admin/players?q=${encodeURIComponent(q)}`)}>
            Search
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Club</th>
              <th>Status</th>
              <th>Rating</th>
              <th>Record a move (takes effect at the next deadline)</th>
            </tr>
          </thead>
          <tbody>
            {(res.data ?? []).map(({ player: p, clubCode }) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.position}</td>
                <td>{clubCode ?? '—'}</td>
                <td>{p.status}</td>
                <td>
                  <button
                    className="act secondary"
                    onClick={() => {
                      const r = Number(prompt('New rating (40-99)', String(p.rating)));
                      const all = confirm('Also re-rate existing cards of this player?');
                      if (r)
                        void run(
                          `Set ${p.name} rating to ${r}`,
                          () =>
                            admin(`/admin/players/${p.id}/rating`, {
                              method: 'PUT',
                              body: { rating: r, applyToCards: all },
                            }),
                          res.reload,
                        );
                    }}
                  >
                    {p.rating}
                  </button>
                </td>
                <td className="row">
                  <select id={`club-${p.id}`} defaultValue="">
                    <option value="">New club…</option>
                    {(clubs.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <button
                    className="act secondary"
                    onClick={() => {
                      const toClubId = (document.getElementById(`club-${p.id}`) as HTMLSelectElement).value;
                      void run(
                        `Transfer ${p.name}`,
                        () =>
                          admin('/admin/moves', {
                            body: {
                              playerId: p.id,
                              kind: p.status === 'active' ? 'transfer' : 'returned',
                              toClubId,
                            },
                          }),
                        moves.reload,
                      );
                    }}
                  >
                    {p.status === 'active' ? 'Transfer' : 'Returns'}
                  </button>
                  <button
                    className="act danger"
                    onClick={() =>
                      run(
                        `${p.name} leaves the league`,
                        () => admin('/admin/moves', { body: { playerId: p.id, kind: 'left_league' } }),
                        moves.reload,
                      )
                    }
                  >
                    Leaves league
                  </button>
                  <button
                    className="act danger"
                    onClick={() =>
                      run(
                        `${p.name} retires`,
                        () => admin('/admin/moves', { body: { playerId: p.id, kind: 'retired' } }),
                        moves.reload,
                      )
                    }
                  >
                    Retires
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Recorded moves</h2>
        <p className="muted">
          The worker applies due moves every minute. Owners of inactive cards get a free same-rarity swap pack
          and one grouped notification.
        </p>
        <button
          className="act"
          onClick={() =>
            run('Apply due moves now', () => admin('/admin/moves/process', { body: {} }), moves.reload)
          }
        >
          Apply due moves now
        </button>
        <pre>{JSON.stringify(moves.data, null, 1)}</pre>
      </section>
      {view}
    </>
  );
}

function Clubs() {
  const clubs = useLoad<ClubRow[]>('/admin/clubs');
  const { run, view } = useAction();
  return (
    <section>
      <h2>Clubs</h2>
      <p className="muted">
        Season end: relegated clubs' cards go inactive with a free swap pack per card; promoted clubs' players
        join the pack pool.
      </p>
      <table>
        <tbody>
          {(clubs.data ?? []).map((c) => (
            <tr key={c.id}>
              <td>{c.code}</td>
              <td>{c.name}</td>
              <td>{c.inLeague ? 'In league' : 'Not in league'}</td>
              <td>
                {c.inLeague ? (
                  <button
                    className="act danger"
                    onClick={() =>
                      run(
                        `Relegate ${c.name}`,
                        () => admin(`/admin/clubs/${c.id}/relegate`, { body: {} }),
                        clubs.reload,
                      )
                    }
                  >
                    Relegate
                  </button>
                ) : (
                  <button
                    className="act"
                    onClick={() =>
                      run(
                        `Promote ${c.name}`,
                        () => admin(`/admin/clubs/${c.id}/promote`, { body: {} }),
                        clubs.reload,
                      )
                    }
                  >
                    Promote
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {view}
    </section>
  );
}

interface UserDetail {
  profile: { id: string; displayName: string; inviteCode: string; createdAt: string };
  balance: number;
  ledgerReconciles: boolean;
  ledger: { id: number; amount: number; reason: string; ref: string | null; createdAt: string }[];
  cards: {
    card: {
      id: string;
      rarity: string;
      rating: number;
      level: number;
      active: boolean;
      inactiveReason: string | null;
    };
    name: string;
    position: string;
  }[];
  scores: {
    gameweek: number;
    total: number;
    provisional: boolean;
    actionsLanded: number;
    actionsPicked: number;
    rulesVersion: string;
    breakdown: { slots: { slot: number; role: string; points: number; lines: { explanation: string }[] }[] };
  }[];
}

function Users() {
  const [q, setQ] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const found = useLoad<{ id: string; displayName: string; inviteCode: string }[]>(path);
  const [userId, setUserId] = useState<string | null>(null);
  const detail = useLoad<UserDetail>(userId ? `/admin/users/${userId}` : null);
  const { run, view } = useAction();
  const d = detail.data;
  return (
    <>
      <section>
        <h2>Find a user</h2>
        <div className="row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, invite code, phone or id"
          />
          <button className="act" onClick={() => setPath(`/admin/users?q=${encodeURIComponent(q)}`)}>
            Search
          </button>
        </div>
        <p className="muted">Phone numbers are matched by hash; they are never stored or shown.</p>
        {(found.data ?? []).map((u) => (
          <div key={u.id} className="row">
            <button className="act secondary" onClick={() => setUserId(u.id)}>
              {u.displayName} · {u.inviteCode}
            </button>
          </div>
        ))}
      </section>
      {d ? (
        <>
          <section>
            <h2>{d.profile.displayName}</h2>
            <p>
              Balance <b>{d.balance} Coins</b> · ledger{' '}
              {d.ledgerReconciles ? (
                <span className="ok">reconciles</span>
              ) : (
                <span className="err">DOES NOT RECONCILE</span>
              )}
            </p>
            <div className="row">
              <button
                className="act secondary"
                onClick={() => {
                  const amount = Number(prompt('Coins to add (negative to remove)'));
                  const reason = prompt('Reason') ?? '';
                  if (amount)
                    void run(
                      `Adjust Coins by ${amount}`,
                      () => admin(`/admin/users/${d.profile.id}/coins`, { body: { amount, reason } }),
                      detail.reload,
                    );
                }}
              >
                Adjust Coins
              </button>
              <button
                className="act danger"
                onClick={() =>
                  run(
                    `Delete (anonymise) ${d.profile.displayName}`,
                    () => admin(`/admin/users/${d.profile.id}/delete`, { body: {} }),
                    detail.reload,
                  )
                }
              >
                Delete account
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {d.ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.createdAt).toLocaleString('en-GB')}</td>
                    <td>{l.amount}</td>
                    <td>{l.reason}</td>
                    <td>{l.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h2>Scoring breakdown</h2>
            {d.scores.map((s) => (
              <details key={s.gameweek}>
                <summary>
                  GW{s.gameweek}: {s.total} pts · {s.actionsLanded}/{s.actionsPicked} landed · v
                  {s.rulesVersion}
                  {s.provisional ? ' · provisional' : ''}
                </summary>
                {s.breakdown.slots.map((sl) => (
                  <div key={sl.slot}>
                    <b>Slot {sl.slot}</b> ({sl.role}, {sl.points} pts)
                    <ul>
                      {sl.lines.map((l, i) => (
                        <li key={i}>{l.explanation}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            ))}
          </section>
          <section>
            <h2>Cards</h2>
            <table>
              <tbody>
                {d.cards.map((c) => (
                  <tr key={c.card.id}>
                    <td>{c.name}</td>
                    <td>{c.position}</td>
                    <td>{c.card.rarity}</td>
                    <td>
                      <button
                        className="act secondary"
                        onClick={() => {
                          const r = Number(prompt('Card rating (40-99)', String(c.card.rating)));
                          if (r)
                            void run(
                              `Set card rating ${r}`,
                              () =>
                                admin(`/admin/cards/${c.card.id}/rating`, {
                                  method: 'PUT',
                                  body: { rating: r },
                                }),
                              detail.reload,
                            );
                        }}
                      >
                        {c.card.rating}
                      </button>
                    </td>
                    <td>Lv {c.card.level}</td>
                    <td>{c.card.active ? 'active' : `inactive (${c.card.inactiveReason})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
      {view}
    </>
  );
}

function Packs() {
  const [userId, setUserId] = useState('');
  const [path, setPath] = useState('/admin/packs?limit=100');
  const logs = useLoad<
    {
      id: string;
      userId: string;
      type: string;
      source: string;
      openedAt: string;
      oddsVersion: string;
      seed: string;
      result: unknown;
    }[]
  >(path);
  return (
    <section>
      <h2>Pack-open log</h2>
      <div className="row">
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User id (optional)" />
        <button
          className="act"
          onClick={() => setPath(`/admin/packs?limit=100${userId ? `&userId=${userId}` : ''}`)}
        >
          Filter
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Opened</th>
            <th>User</th>
            <th>Pack</th>
            <th>Source</th>
            <th>Odds</th>
            <th>Seed</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {(logs.data ?? []).map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.openedAt).toLocaleString('en-GB')}</td>
              <td>{p.userId.slice(0, 8)}</td>
              <td>{p.type}</td>
              <td>{p.source}</td>
              <td>v{p.oddsVersion}</td>
              <td>{p.seed}</td>
              <td>
                <pre>
                  {JSON.stringify(
                    (p.result as { cards?: unknown[] })?.cards?.map((c) => {
                      const x = c as { name: string; rarity: string; duplicate: boolean };
                      return `${x.name} (${x.rarity}${x.duplicate ? ', dup' : ''})`;
                    }),
                  )}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Config() {
  const list =
    useLoad<
      { id: string; kind: string; version: string; season: string; active: boolean; createdAt: string }[]
    >('/admin/config');
  const [kind, setKind] = useState<'scoring' | 'economy' | 'packs'>('economy');
  const [text, setText] = useState('');
  const { run, view } = useAction();
  const load = async (id: string) => {
    const row = await admin<{ kind: 'scoring' | 'economy' | 'packs'; body: unknown }>(`/admin/config/${id}`);
    setKind(row.kind);
    setText(JSON.stringify(row.body, null, 2));
  };
  return (
    <>
      <section>
        <h2>Versions</h2>
        <p className="muted">
          Points and prices are data. Upload a new version, then activate it. Gameweeks already locked keep
          the scoring version they locked with.
        </p>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Version</th>
              <th>Season</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.kind}</td>
                <td>{c.version}</td>
                <td>{c.season}</td>
                <td>{c.active ? '✓ active' : ''}</td>
                <td className="row">
                  <button className="act secondary" onClick={() => load(c.id)}>
                    Edit as new
                  </button>
                  {!c.active ? (
                    <button
                      className="act"
                      onClick={() =>
                        run(
                          `Activate ${c.kind} v${c.version}`,
                          () =>
                            admin('/admin/config/activate', { body: { kind: c.kind, version: c.version } }),
                          list.reload,
                        )
                      }
                    >
                      Activate
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Upload a version</h2>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="scoring">scoring</option>
            <option value="economy">economy</option>
            <option value="packs">packs</option>
          </select>
          <span className="muted">Change the "version" field before uploading.</span>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="act"
          onClick={() =>
            run(
              `Upload ${kind} config`,
              () => admin('/admin/config', { body: { kind, body: JSON.parse(text) } }),
              list.reload,
            )
          }
        >
          Upload (validated)
        </button>
      </section>
      {view}
    </>
  );
}

function Audit() {
  const rows =
    useLoad<{ id: number; staff: string; action: string; payload: unknown; at: string }[]>('/admin/audit');
  return (
    <section>
      <h2>Audit log</h2>
      <table>
        <tbody>
          {(rows.data ?? []).map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.at).toLocaleString('en-GB')}</td>
              <td>{r.staff}</td>
              <td>{r.action}</td>
              <td>
                <code>{JSON.stringify(r.payload)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>('gameweeks');
  const [token, setTok] = useState(getToken());
  if (!token) {
    return (
      <main>
        <section>
          <h2>Staff sign-in</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const t = new FormData(e.currentTarget).get('t') as string;
              setToken(t);
              setTok(t);
            }}
          >
            <input name="t" type="password" placeholder="Staff token" autoComplete="off" />
            <button className="act">Sign in</button>
          </form>
        </section>
      </main>
    );
  }
  return (
    <>
      <header>
        <h1>Fantasy Five · Staff</h1>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </header>
      <main>
        {tab === 'gameweeks' ? (
          <Gameweeks />
        ) : tab === 'players' ? (
          <Players />
        ) : tab === 'clubs' ? (
          <Clubs />
        ) : tab === 'users' ? (
          <Users />
        ) : tab === 'packs' ? (
          <Packs />
        ) : tab === 'config' ? (
          <Config />
        ) : (
          <Audit />
        )}
      </main>
    </>
  );
}
