import React, { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/MainNavigation";
import { loginUser } from "../api/authApi";
import AppLogo from "../components/AppLogo";
import AppFooter from "../components/AppFooter";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      Alert.alert("Calmward", "Escribe correo y contraseña.");
      return;
    }

    try {
      setLoading(true);
      const data = await loginUser(cleanEmail, cleanPassword);

      if (!data || !data.token) {
        Alert.alert(
          "No se pudo iniciar sesión",
          data?.error || "Revisa los datos o inténtalo de nuevo."
        );
        return;
      }

      navigation.reset({
        index: 0,
        routes: [{ name: "Home" }],
      });
    } catch (e: any) {
      Alert.alert(
        "Error",
        e?.message || "No se ha podido conectar con el servidor."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <AppLogo size="md" showText />

          <Text style={styles.title}>Iniciar sesión</Text>
          <Text style={styles.subtitle}>
            Accede a tu espacio en Calmward. Tus datos se guardan en tu cuenta
            remota y en tu dispositivo.
          </Text>

          <Text style={styles.label}>Correo electrónico</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="tucorreo@example.com"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#6b7280"
          />

          <View style={styles.row}>
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setRemember(!remember)}
            >
              <View
                style={[
                  styles.checkbox,
                  remember && styles.checkboxChecked,
                ]}
              >
                {remember && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>
                Recordar sesión en este dispositivo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate("Recover")}
            >
              <Text style={styles.recoverLink}>
                ¿Olvidaste tu contraseña?
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.mainButton, loading && styles.mainButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.mainButtonText}>
              {loading ? "Entrando..." : "Entrar"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate("Register")}
          >
            <Text style={styles.secondaryText}>Crear cuenta nueva</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.info}>
          Calmward no es un servicio médico ni de emergencias. Si estás en
          peligro, busca ayuda directa.
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
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    justifyContent: "center",
    paddingBottom: 32,
  },
  card: {
    backgroundColor: "#0f172a",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#e2e8f0",
    marginTop: 12,
  },
  subtitle: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: "#e5e7eb",
    marginTop: 8,
    marginBottom: 2,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#e5e7eb",
    fontSize: 13,
    backgroundColor: "#020617",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#4b5563",
    marginRight: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#0ea5e9",
    borderColor: "#0ea5e9",
  },
  checkboxMark: {
    color: "#e0f2fe",
    fontSize: 12,
  },
  checkLabel: {
    fontSize: 11,
    color: "#9ca3af",
  },
  recoverLink: {
    fontSize: 11,
    color: "#38bdf8",
  },
  mainButton: {
    marginTop: 16,
    borderRadius: 999,
    backgroundColor: "#0ea5e9",
    paddingVertical: 10,
    alignItems: "center",
  },
  mainButtonDisabled: {
    opacity: 0.7,
  },
  mainButtonText: {
    color: "#e0f2fe",
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    marginTop: 10,
    alignItems: "center",
  },
  secondaryText: {
    fontSize: 13,
    color: "#e5e7eb",
  },
  info: {
    marginTop: 12,
    fontSize: 11,
    color: "#9ca3af",
    textAlign: "center",
  },
});
