import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import * as Linking from "expo-linking";

import { getPlans, createSubscription, confirmSubscription } from "../services/billing";
import { useSession } from "../state/session";

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
    return () => { mounted = false; };
  }, []);

  const byType = useMemo(() => {
    const sponsor = plans.filter(p => String(p.planKey).startsWith("sponsor_"));
    const premium = plans.filter(p => String(p.planKey).startsWith("premium_"));
    return { sponsor, premium };
  }, [plans]);

  async function handleBuy(planKey: string) {
    if (!token) {
      Alert.alert("Necesitas sesión", "Inicia sesión para gestionar tu plan.");
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
                Alert.alert("Confirmación", e.message || "No se pudo confirmar.");
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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Cargando planes...</Text>
      </View>
    );
  }

  function PlanCard({ p }: any) {
    const disabled = !p.hasPlanId || !!busyKey;
    return (
      <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "600" }}>{p.label}</Text>
        <Text style={{ marginTop: 4 }}>{p.price} €</Text>

        <TouchableOpacity
          disabled={disabled}
          onPress={() => handleBuy(p.planKey)}
          style={{
            marginTop: 10,
            opacity: disabled ? 0.5 : 1,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: 1,
            alignItems: "center",
          }}
        >
          <Text>
            {busyKey === p.planKey ? "Procesando..." : "Suscribirme"}
          </Text>
        </TouchableOpacity>

        {!p.hasPlanId && (
          <Text style={{ marginTop: 6, fontSize: 12 }}>
            Plan no configurado en el servidor.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 12 }}>
        Planes Calmward
      </Text>

      <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 8 }}>
        Sponsor
      </Text>
      {byType.sponsor.map((p) => (
        <PlanCard key={p.planKey} p={p} />
      ))}

      <Text style={{ fontSize: 16, fontWeight: "600", marginTop: 10, marginBottom: 8 }}>
        Premium
      </Text>
      {byType.premium.map((p) => (
        <PlanCard key={p.planKey} p={p} />
      ))}
    </View>
  );
}
