import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { logoutUser, getStoredUser } from "../api/authApi";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/MainNavigation";
import AppFooter from "../components/AppFooter";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: Props) {
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    async function loadUser() {
      const u = await getStoredUser();
      if (u) {
        setUserName(u.name || null);
        setUserEmail(u.email || null);
      }
    }
    loadUser();
  }, []);

  async function handleLogout() {
    await logoutUser();
    Alert.alert("Sesión cerrada", "Se ha cerrado la sesión en este dispositivo.");
    navigation.reset({
      index: 0,
      routes: [{ name: "Home" }],
    });
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Perfil</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Nombre</Text>
          <Text style={styles.value}>
            {userName || "Sin nombre configurado"}
          </Text>

          <Text style={styles.label}>Correo</Text>
          <Text style={styles.value}>
            {userEmail || "Sin correo disponible"}
          </Text>
        </View>

        <Text style={styles.text}>
          En futuras versiones podrás configurar notificaciones, contactos de
          confianza y más opciones de privacidad.
        </Text>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>
            Cerrar sesión en este dispositivo
          </Text>
        </TouchableOpacity>

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
    color: "#e5e7eb",
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
    marginBottom: 12,
  },
  label: {
    fontSize: 11,
    color: "#94a3b8",
  },
  value: {
    fontSize: 13,
    color: "#e5e7eb",
    marginBottom: 8,
  },
  text: {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 20,
  },
  logoutButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f97373",
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 24,
  },
  logoutText: {
    color: "#fecaca",
    fontSize: 13,
    fontWeight: "600",
  },
});
