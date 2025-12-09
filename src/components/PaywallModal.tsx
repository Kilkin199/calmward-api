import React from "react";
import { Modal, View, Text, TouchableOpacity } from "react-native";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onGoPlans: () => void;
};

export default function PaywallModal({
  visible,
  title,
  message,
  onClose,
  onGoPlans,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.35)",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: "white",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
            {title}
          </Text>
          <Text style={{ fontSize: 14, opacity: 0.8 }}>
            {message}
          </Text>

          <View style={{ flexDirection: "row", marginTop: 16 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                alignItems: "center",
                marginRight: 8,
              }}
            >
              <Text>Cerrar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onGoPlans}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                alignItems: "center",
              }}
            >
              <Text>Ver planes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
