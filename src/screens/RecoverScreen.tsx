import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/MainNavigation";
import { recoverPassword } from "../api/authApi";

type Props = NativeStackScreenProps<RootStackParamList, "Recover">;

export default function RecoverScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRecover() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      Alert.alert("Calmward", "Escribe tu correo.");
      return;
    }

    try {
      setLoading(true);
      const data = await recoverPassword(cleanEmail);
      Alert.alert(
        "Revisa tu correo",
        data?.message ||
          "Si el correo existe en el sistema, se enviarÃ¡n instrucciones."
      );
      navigation.goBack();
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
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Recuperar contraseÃ±a</Text>
        <Text style={styles.subtitle}>
          Escribe tu correo y, si existe en el sistema, se te enviarÃ¡n
          instrucciones para recuperar el acceso.
        </Text>

        <Text style={styles.label}>Correo electrÃ³nico</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="tucorreo@example.com"
          placeholderTextColor="#6b7280"
        />

        <TouchableOpacity
          style={[styles.mainButton, loading && styles.mainButtonDisabled]}
          onPress={handleRecover}
          disabled={loading}
        >
          <Text style={styles.mainButtonText}>
            {loading ? "Enviando..." : "Enviar instrucciones"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.secondaryText}>Volver</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
    padding: 20,
    justifyContent: "center",
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    color: "#9ca3af",
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