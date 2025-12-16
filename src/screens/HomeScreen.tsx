import React from "react";
import { SafeAreaView, View, Text, StyleSheet, ScrollView } from "react-native";
import AppLogo from "../components/AppLogo";
import AppFooter from "../components/AppFooter";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <AppLogo size="lg" showText />
          <Text style={styles.title}>Bienvenido a Calmward</Text>
          <Text style={styles.text}>
            Un lugar tranquilo para registrar cómo estás, hablar con una IA que
            no juzga y tener a mano recursos cuando los necesites.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Qué puedes hacer aquí</Text>
          <Text style={styles.text}>
            • Guardar tu día con un nivel del 1 al 5 y una nota opcional.{"\n"}
            • Conversar con la IA cuando quieras desahogarte.{"\n"}
            • Ver tu recorrido con el tiempo en “Tu día”.{"\n"}
            • Acceder rápidamente a ayuda urgente si lo necesitas.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Para empresas</Text>
          <Text style={styles.text}>
            Más adelante podrás incluir aquí espacios de colaboración o
            visibilidad para proyectos relacionados con el bienestar, siempre
            sin publicidad invasiva.
          </Text>
        </View>

        <Text style={styles.closing}>
          Esta app no pretende sustituir a profesionales ni servicios de
          emergencia. Es un acompañamiento suave para tu día a día.
        </Text>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
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
    lineHeight: 18,
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
    lineHeight: 17,
  },
});
