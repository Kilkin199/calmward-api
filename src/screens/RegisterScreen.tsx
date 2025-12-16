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
import { registerUser } from "../api/authApi";
import AppLogo from "../components/AppLogo";
import AppFooter from "../components/AppFooter";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

export default function RegisterScreen({ navigation }: Props) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanName || !cleanEmail || !cleanPassword) {
      Alert.alert("Calmward", "Rellena nombre, correo y contraseña.");
      return;
    }
    if (!acceptTerms) {
      Alert.alert("Calmward", "Debes aceptar las condiciones.");
      return;
    }

    try {
      setLoading(true);
      const data = await registerUser({
        name: cleanName,
        email: cleanEmail,
        password: cleanPassword,
        country: country.trim(),
        acceptTerms: true,
      });

      if (!data || !data.ok) {
        Alert.alert(
          "No se pudo crear la cuenta",
          data?.error || "Prueba con otro correo o inténtalo más tarde."
        );
        return;
      }

      Alert.alert("Cuenta creada", "Ahora puedes iniciar sesión.", [
        {
          text: "Ir a iniciar sesión",
          onPress: () => navigation.navigate("Login"),
        },
      ]);
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

          <Text style={styles.title}>Crear cuenta</Text>
          <Text style={styles.subtitle}>
            Crea tu espacio en Calmward para poder guardar tu recorrido y hablar
            con la IA cuando lo necesites.
          </Text>

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Cómo quieres que te llamemos"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>País (opcional)</Text>
          <TextInput
            style={styles.input}
            value={country}
            onChangeText={setCountry}
            placeholder="España, México..."
            placeholderTextColor="#6b7280"
          />

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

          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => setAcceptTerms(!acceptTerms)}
          >
            <View
              style={[
                styles.checkbox,
                acceptTerms && styles.checkboxChecked,
              ]}
            >
              {acceptTerms && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>
              Acepto el tratamiento de datos y las condiciones de uso.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mainButton, loading && styles.mainButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.mainButtonText}>
              {loading ? "Creando..." : "Crear cuenta"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={styles.secondaryText}>Ya tengo cuenta</Text>
          </TouchableOpacity>
        </View>

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
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
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
    flex: 1,
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
});
