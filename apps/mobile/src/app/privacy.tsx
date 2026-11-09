import { DISCLAIMER } from '@ff/shared';
import { Body, H1, H3, Screen, Small } from '../components/ui';

/** Privacy notice (UK GDPR). Mirrors docs/PRIVACY.md. */
export default function Privacy() {
  return (
    <Screen>
      <H1>Privacy notice</H1>
      <Small>{DISCLAIMER}</Small>
      <H3>What we collect</H3>
      <Body>
        A one-way keyed hash of your mobile number (we cannot read the number back), your display name,
        optional favourite club, the date you confirmed you are 16 or over, your cards, picks, scores, Coins
        ledger, league memberships, notification settings and push token, and app usage events used to measure
        the test.
      </Body>
      <H3>Why</H3>
      <Body>
        To run your account and the game (contract), and to measure and improve the closed test (legitimate
        interests). Phone verification is done by our SMS provider, which receives your number only to send
        the code.
      </Body>
      <H3>Match statistics</H3>
      <Body>
        Scores are worked out from publicly reported match statistics about professional players (goals,
        assists, minutes and similar). We process these under legitimate interests: they are already public,
        used only for game scoring, and we show names, positions, shirt numbers and club codes only — no
        photos.
      </Body>
      <H3>Sharing and retention</H3>
      <Body>
        No advertising, no sale of data. Hosting and SMS providers process data for us. Test data is deleted
        within 90 days of the test ending, or sooner if you ask.
      </Body>
      <H3>Your rights</H3>
      <Body>
        Access, correction, deletion, objection and complaint to the ICO (ico.org.uk). Contact the test team
        from the TestFlight / Play invite email.
      </Body>
    </Screen>
  );
}
