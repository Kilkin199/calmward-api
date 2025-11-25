import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";

export default function UrgentHelpScreen() {
  function callNumber(phone: string) {
    Linking.openURL("tel:" + phone).catch(() => {});
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Ayuda urgente</Text>
      <Text style={styles.subtitle}>
        Calmward no es un servicio de emergencias ni sustituye la ayuda
        profesional en salud mental.
      </Text>

      <Text style={styles.text}>
        Si sientes que estÃ¡s en peligro, al lÃ­mite o podrÃ­as hacerte daÃ±o:
      </Text>

      <View style={styles.list}>
        <Text style={styles.item}>â€¢ Llama a los servicios de emergencia de tu paÃ­s.</Text>
        <Text style={styles.item}>â€¢ Contacta con una persona de confianza.</Text>
        <Text style={styles.item}>
          â€¢ Busca telÃ©fonos de ayuda emocional o prevenciÃ³n del suicidio en tu
          zona.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.emergencyButton}
        onPress={() => callNumber("112")}
      >
        <Text style={styles.emergencyText}>Llamar al 112 (ejemplo)</Text>
      </TouchableOpacity>

      <Text style={styles.small}>
        MÃ¡s adelante puedes personalizar estos nÃºmeros para adaptarlos a tu paÃ­s
        o regiÃ³n.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    color: "#fecaca",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#e5e7eb",
    marginBottom: 16,
  },
  text: {
    fontSize: 13,
    color: "#e5e7eb",
    marginBottom: 8,
  },
  list: {
    marginBottom: 16,
  },
  item: {
    fontSize: 13,
    color: "#e5e7eb",
    marginBottom: 4,
  },
  emergencyButton: {
    borderRadius: 999,
    backgroundColor: "#b91c1c",
    paddingVertical: 10,
    alignItems: "center",
  },
  emergencyText: {
    color: "#fee2e2",
    fontWeight: "600",
    fontSize: 14,
  },
  small: {
    marginTop: 12,
    fontSize: 11,
    color: "#9ca3af",
  },
});