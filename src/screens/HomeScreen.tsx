import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import AppLogo from "../components/AppLogo";
import AppFooter from "../components/AppFooter";

export default function HomeScreen() {
  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <AppLogo size="lg" showText />
          <Text style={styles.title}>Bienvenido a Calmward</Text>
          <Text style={styles.text}>
            Un lugar tranquilo para registrar cÃ³mo estÃ¡s, hablar con una IA que
            no juzga y tener a mano recursos cuando los necesites.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>QuÃ© puedes hacer aquÃ­</Text>
          <Text style={styles.text}>
            â€¢ Guardar tu dÃ­a con un nivel del 1 al 5 y una nota opcional.{"\n"}
            â€¢ Conversar con la IA cuando quieras desahogarte.{"\n"}
            â€¢ Ver tu recorrido con el tiempo en Tu dÃ­a.{"\n"}
            â€¢ Acceso rÃ¡pido a ayuda urgente si lo necesitas.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Para empresas</Text>
          <Text style={styles.text}>
            MÃ¡s adelante podrÃ¡s incluir aquÃ­ espacios de colaboraciÃ³n o
            visibilidad para proyectos relacionados con bienestar, siempre sin
            publicidad invasiva.
          </Text>
        </View>

        <Text style={styles.closing}>
          Esta app no pretende sustituir a profesionales ni servicios de
          emergencia. Es un acompaÃ±amiento suave para tu dÃ­a a dÃ­a.
        </Text>
      </ScrollView>
      <AppFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020617" },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 20,
    borderRadius: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    color: "#e2e8f0",
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
  text: {
    color: "#94a3b8",
    fontSize: 13,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#e5e7eb",
    marginBottom: 6,
  },
  closing: {
    marginTop: 16,
    fontSize: 12,
    color: "#9ca3af",
  },
});