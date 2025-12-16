import React, { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from "react-native";
import AppFooter from "../components/AppFooter";

export default function UrgentHelpScreen() {
  const [showPhones, setShowPhones] = useState(false);

  function callNumber(phone: string) {
    Linking.openURL("tel:" + phone).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Ayuda urgente</Text>
        <Text style={styles.subtitle}>
          Calmward no es un servicio de emergencias ni sustituye la ayuda
          profesional en salud mental.
        </Text>

        <Text style={styles.text}>
          Si sientes que estás en peligro, al límite o podrías hacerte daño:
        </Text>

        <View style={styles.list}>
          <Text style={styles.item}>
            • Llama a los servicios de emergencia de tu país.
          </Text>
          <Text style={styles.item}>
            • Contacta con una persona de confianza.
          </Text>
          <Text style={styles.item}>
            • Busca teléfonos de ayuda emocional o prevención del suicidio en tu
            zona.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.emergencyButton}
          onPress={() => callNumber("112")}
        >
          <Text style={styles.emergencyText}>Llamar al 112 (emergencias)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setShowPhones((prev) => !prev)}
        >
          <Text style={styles.secondaryText}>
            {showPhones
              ? "Ocultar teléfonos de ayuda"
              : "Buscar teléfonos de ayuda"}
          </Text>
        </TouchableOpacity>

        {showPhones && (
          <View style={styles.phoneCard}>
            <Text style={styles.phoneTitle}>
              Ejemplos de teléfonos de ayuda (España)
            </Text>
            <Text style={styles.phoneItem}>
              • 112 – Emergencias generales (24h).
            </Text>
            <Text style={styles.phoneItem}>
              • 024 – Línea de atención a la conducta suicida.
            </Text>
            <Text style={styles.phoneItem}>
              • Puedes buscar también “teléfono ayuda emocional” + tu país para
              encontrar recursos locales.
            </Text>
          </View>
        )}

        <Text style={styles.small}>
          Más adelante podrás personalizar estos números para adaptarlos a tu
          país o región.
        </Text>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
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
    marginBottom: 10,
  },
  emergencyText: {
    color: "#fee2e2",
    fontWeight: "600",
    fontSize: 14,
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f97316",
    paddingVertical: 9,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryText: {
    color: "#fed7aa",
    fontSize: 13,
    fontWeight: "500",
  },
  phoneCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#020617",
    padding: 12,
    marginBottom: 8,
  },
  phoneTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#e5e7eb",
    marginBottom: 6,
  },
  phoneItem: {
    fontSize: 12,
    color: "#cbd5f5",
    marginBottom: 4,
  },
  small: {
    marginTop: 8,
    fontSize: 11,
    color: "#9ca3af",
    marginBottom: 24,
  },
});
