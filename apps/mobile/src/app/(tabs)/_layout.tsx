import { Tabs } from 'expo-router';
import type { TabBarProps } from '../../components/TabBar';
import { TabBar } from '../../components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(p) => <TabBar {...(p as unknown as TabBarProps)} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="squad" />
      <Tabs.Screen name="collection" />
      <Tabs.Screen name="leagues" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
