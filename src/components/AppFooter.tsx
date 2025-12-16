import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function AppFooter() {
  return (
    <View style={styles.root}>
      <Text style={styles.legal}>
        Calmward no sustituye servicios médicos ni de emergencia. Si estás en
        peligro o al límite, busca ayuda profesional o llama a los servicios de
        emergencia de tu país.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    alignItems: "center",
    backgroundColor: "#020617",
  },
  legal: {
    fontSize: 11,
    color: "#64748b",
    textAlign: "center",
  },
});
