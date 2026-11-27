import { t } from '@suitenova/core-ui';
import { PARTSTATS, conflicts, describeEvent, findInvite, inviteState, organizes, type MailRecord, type ParsedMessage, type PartStat } from '@suitenova/mail-core';
import { useState } from 'react';
import type { Answer } from './calendar';
import type { MailCtl } from './ctl';

const ANSWERED: Record<Answer, string> = { accepted: 'Aceptaste esta invitación.', tentative: 'Contestaste que quizá asistas.', declined: 'Rechazaste esta invitación.' };

/** What a message says about a meeting, with what can be done about it. */
export function InviteCard({ ctl, rec, parsed }: { ctl: MailCtl; rec: MailRecord; parsed: ParsedMessage }) {
  const invite = findInvite(parsed);
  const canTell = ctl.calendar.canInvite;
  const [tell, setTell] = useState(true);
  const [err, setErr] = useState('');
  if (!invite) return null;
  const e = invite.event;
  const own = ctl.ownAddresses();
  const state = inviteState(ctl.data, invite, rec.fromEmail);
  const mine = !!e.organizer && organizes(e, own);
  const there = state.existing;
  const overlap = invite.method === 'REQUEST' && !mine ? conflicts(ctl.data, e) : [];
  const run = (what: () => void) => {
    try {
      what();
      setErr('');
    } catch (x) {
      setErr(t((x as Error).message));
    }
  };
  const open = there && (
    <button type="button" className="ml-btn" onClick={() => ctl.openEvent(there.id)}>
      {t('Ver en el calendario')}
    </button>
  );

  if (invite.method === 'REPLY') {
    const answer = e.attendees?.find((a) => a.email.toLowerCase() === rec.fromEmail.toLowerCase()) ?? e.attendees?.[0];
    const noted = answer && there?.attendees?.some((a) => a.email.toLowerCase() === answer.email.toLowerCase() && a.status === answer.status);
    return (
      <section className="ml-invite" aria-label={t('Respuesta a una invitación')}>
        <strong>
          {answer?.name || answer?.email || rec.from}: {answer ? t(PARTSTATS[answer.status]) : ''}
        </strong>
        <span>{there?.title ?? e.title}</span>
        <span className="ml-hint">{noted ? t('La respuesta está anotada en el calendario.') : there ? t('No se anotó: no viene de la persona invitada o es de una versión anterior.') : t('La reunión no está en tu calendario.')}</span>
        {open}
      </section>
    );
  }

  const heading =
    invite.method === 'CANCEL' ? t('Reunión cancelada') : state.kind === 'update' ? t('Cambios en una reunión') : state.kind === 'outdated' ? t('Invitación anticuada') : t('Invitación a una reunión');
  const answered: PartStat | undefined = rec.rsvp;
  return (
    <section className={`ml-invite${invite.method === 'CANCEL' ? ' is-cancelled' : ''}`} aria-label={heading}>
      <strong>
        {heading}: {e.title}
      </strong>
      <span className="ml-invite__when">{describeEvent(e)}</span>
      {e.rrule && <span>{t('Se repite.')}</span>}
      {e.recurrenceId !== undefined && <span>{t('Se refiere solo a una repetición.')}</span>}
      {e.organizer && <span>{t('Organiza {who}.', { who: e.organizer.name ? `${e.organizer.name} <${e.organizer.email}>` : e.organizer.email })}</span>}
      {!!e.attendees?.length && (
        <details>
          <summary>{e.attendees.length === 1 ? t('1 invitado') : t('{n} invitados', { n: e.attendees.length })}</summary>
          <ul className="ml-answers">
            {e.attendees.map((a) => (
              <li key={a.email}>
                <span>{a.name || a.email}</span>
                <em className={`is-${a.status}`}>{t(PARTSTATS[a.status])}</em>
              </li>
            ))}
          </ul>
        </details>
      )}
      {state.warning && (
        <span className="ml-error" role="alert">
          {t(state.warning)}
        </span>
      )}
      {overlap.length > 0 && <span className="ml-invite__busy">{t('A esa hora tienes: {titles}.', { titles: overlap.slice(0, 3).map((x) => x.title).join(', ') })}</span>}
      {invite.method === 'CANCEL' ? (
        there ? (
          <div>
            <button
              type="button"
              className="ml-btn ml-btn--primary"
              onClick={() =>
                run(() => {
                  if (!ctl.calendar.removeCancelled(rec.id)) throw new Error('No se quitó: la cancelación no viene de quien organiza la reunión.');
                })
              }
            >
              {t('Quitar del calendario')}
            </button>
            {open}
          </div>
        ) : (
          <span className="ml-hint">{t('La reunión no está en tu calendario.')}</span>
        )
      ) : mine ? (
        <div>
          <span className="ml-hint">{t('Es una reunión que organizas tú.')}</span>
          {open}
        </div>
      ) : (
        <>
          {answered && <span role="status">{t(ANSWERED[answered])}</span>}
          {state.kind === 'outdated' ? (
            <span className="ml-hint">{t('En tu calendario hay una versión más reciente.')}</span>
          ) : (
            <>
              <div role="group" aria-label={t('Responder a la invitación')}>
                {(['accepted', 'tentative', 'declined'] as const).map((a) => (
                  <button key={a} type="button" className={`ml-btn${a === 'accepted' ? ' ml-btn--primary' : ''}`} aria-pressed={answered === a} onClick={() => run(() => ctl.calendar.respond(rec.id, a, canTell && tell && !!e.organizer))}>
                    {a === 'accepted' ? t('Aceptar') : a === 'tentative' ? t('Provisional') : t('Rechazar')}
                  </button>
                ))}
                {open}
              </div>
              {canTell && e.organizer ? (
                <label className="ml-check">
                  <input type="checkbox" checked={tell} onChange={(x) => setTell(x.target.checked)} /> {t('Enviar mi respuesta a quien organiza')}
                </label>
              ) : (
                <span className="ml-hint">{t('Se anotará en tu calendario sin enviar respuesta: no hay una cuenta con la que enviarla.')}</span>
              )}
            </>
          )}
        </>
      )}
      {err && (
        <span className="ml-error" role="alert">
          {err}
        </span>
      )}
    </section>
  );
}
