import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import * as Linking from "expo-linking";

import {
  getPlans,
  createSubscription,
  confirmSubscription,
} from "../services/billing";
import { useSession } from "../state/session";
import AppFooter from "../components/AppFooter";

export default function PlansScreen() {
  const { token, refreshMe } = useSession();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<any[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getPlans();
        if (mounted) setPlans(data?.plans || []);
      } catch (e: any) {
        Alert.alert("Planes", e.message || "No se pudieron cargar los planes");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const byType = useMemo(() => {
    const sponsor = plans.filter((p) =>
      String(p.planKey).startsWith("sponsor_")
    );
    const premium = plans.filter((p) =>
      String(p.planKey).startsWith("premium_")
    );
    return { sponsor, premium };
  }, [plans]);

  async function handleBuy(planKey: string) {
    if (!token) {
      Alert.alert(
        "Necesitas sesión",
        "Inicia sesión para gestionar tu plan."
      );
      return;
    }

    setBusyKey(planKey);
    try {
      const create = await createSubscription(token, planKey);
      const approveUrl = create?.approveUrl;
      const subscriptionId = create?.subscriptionId;

      if (!approveUrl || !subscriptionId) {
        throw new Error("No se recibió approveUrl/subscriptionId.");
      }

      await Linking.openURL(approveUrl);

      Alert.alert(
        "Completa el pago",
        "Cuando termines en PayPal y vuelvas aquí, pulsa 'Confirmar'.",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Confirmar",
            onPress: async () => {
              try {
                await confirmSubscription(token, subscriptionId, planKey);
                await refreshMe();
                Alert.alert("Listo", "Suscripción activada.");
              } catch (e: any) {
                Alert.alert(
                  "Confirmación",
                  e.message || "No se pudo confirmar."
                );
              }
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert("Pago", e.message || "No se pudo iniciar el pago.");
    } finally {
      setBusyKey(null);
    }
  }

  function PlanCard({ p }: any) {
    const disabled = !p.hasPlanId || !!busyKey;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{p.label}</Text>
        <Text style={styles.cardPrice}>{p.price} €</Text>

        <TouchableOpacity
          disabled={disabled}
          onPress={() => handleBuy(p.planKey)}
          style={[styles.cardButton, disabled && styles.cardButtonDisabled]}
        >
          <Text style={styles.cardButtonText}>
            {busyKey === p.planKey ? "Procesando..." : "Suscribirme"}
          </Text>
        </TouchableOpacity>

        {!p.hasPlanId && (
          <Text style={styles.cardWarning}>
            Plan no configurado en el servidor.
          </Text>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Cargando planes...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Planes Calmward</Text>

        <Text style={styles.sectionTitle}>Sponsor</Text>
        {byType.sponsor.map((p) => (
          <PlanCard key={p.planKey} p={p} />
        ))}

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Premium</Text>
        {byType.premium.map((p) => (
          <PlanCard key={p.planKey} p={p} />
        ))}

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
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 8,
    color: "#e5e7eb",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    color: "#e5e7eb",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: "#e5e7eb",
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    marginBottom: 10,
    backgroundColor: "#020617",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#e5e7eb",
  },
  cardPrice: {
    marginTop: 4,
    color: "#e5e7eb",
  },
  cardButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0ea5e9",
    alignItems: "center",
  },
  cardButtonDisabled: {
    opacity: 0.5,
  },
  cardButtonText: {
    color: "#e0f2fe",
    fontWeight: "500",
  },
  cardWarning: {
    marginTop: 6,
    fontSize: 12,
    color: "#fbbf24",
  },
});
