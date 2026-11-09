import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { pendingInvite } from '../../lib/invite';
import { Loading } from '../../components/ui';

/** Deep link fantasyfive://join/CODE (or https link): remember the code, finish onboarding, land in the league. */
export default function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  useEffect(() => {
    void pendingInvite.set(code).then(() => router.replace('/leagues'));
  }, [code]);
  return <Loading />;
}
