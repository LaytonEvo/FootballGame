import { Pressable, Text, View } from 'react-native';
import { color, font, touch, type } from '../lib/theme';

export function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? color.active : color.border,
          backgroundColor: checked ? color.active : color.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Text style={{ color: '#fff', fontFamily: font.bodyBold }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.body, color: color.ink }}>{label}</Text>
    </Pressable>
  );
}
