import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from "react-native";
import { saveDay, getSummary } from "../api/statsApi";

type Entry = {
  id?: string;
  level: number;
  note?: string;
  createdAt?: string;
};

export default function TuDiaScreen() {
  const [level, setLevel] = useState(3);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);

  async function loadSummary() {
    try {
      setLoading(true);
      const data = await getSummary();
      if (data?.entries && Array.isArray(data.entries)) {
        setEntries(data.entries);
      } else {
        setEntries([]);
      }
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  async function handleSave() {
    if (saving) return;

    try {
      setSaving(true);
      const res = await saveDay(level, note.trim());
      if (res?.ok === false) {
        Alert.alert("No se pudo guardar", res.error || "IntÃ©ntalo mÃ¡s tarde.");
      }
      await loadSummary();
      setNote("");
    } catch (e: any) {
      Alert.alert(
        "Error",
        e?.message || "No se ha podido conectar con el servidor."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <Text style={styles.title}>Tu dÃ­a</Text>
        <Text style={styles.subtitle}>
          Marca cÃ³mo estÃ¡s hoy y, si quieres, aÃ±ade unas palabras. No es un
          examen, solo un registro para ti.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Â¿CÃ³mo te sientes ahora mismo?</Text>
          <View style={styles.levelRow}>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity
                key={v}
                style={[
                  styles.levelButton,
                  level === v && styles.levelButtonActive,
                ]}
                onPress={() => setLevel(v)}
              >
                <Text
                  style={[
                    styles.levelText,
                    level === v && styles.levelTextActive,
                  ]}
                >
                  {v}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.labelSmall}>Â¿Quieres aÃ±adir algo?</Text>
          <TextInput
            style={styles.input}
            multiline
            value={note}
            onChangeText={setNote}
            placeholder="Escribe una nota corta si te apetece..."
            placeholderTextColor="#6b7280"
          />

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>
              {saving ? "Guardando..." : "Guardar dÃ­a de hoy"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.historyHeader}>
          <Text style={styles.historyTitle}>Ãšltimos registros</Text>
          {loading && <Text style={styles.historyLoading}>Cargando...</Text>}
        </View>

        <View style={styles.historyList}>
          {!loading && entries.length === 0 && (
            <Text style={styles.historyEmpty}>
              Cuando empieces a guardar, verÃ¡s aquÃ­ un pequeÃ±o historial.
            </Text>
          )}
          {entries.map((e, index) => {
            const created =
              e.createdAt || new Date().toISOString();
            const d = new Date(created);
            const formatted = d.toLocaleDateString("es-ES", {
              weekday: "short",
              day: "2-digit",
              month: "short",
            });

            return (
              <View key={e.id || index.toString()} style={styles.historyItem}>
                <View style={styles.historyLeft}>
                  <Text style={styles.historyDate}>{formatted}</Text>
                  {e.note ? (
                    <Text style={styles.historyNote}>{e.note}</Text>
                  ) : null}
                </View>
                <View style={styles.historyBadge}>
                  <Text style={styles.historyBadgeLabel}>Nivel</Text>
                  <View style={styles.historyBadgeCircle}>
                    <Text style={styles.historyBadgeValue}>{e.level}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.footerText}>
          Hay dÃ­as buenos, malos y raros. Que los puedas ver en conjunto a veces
          ayuda a entender que nada dura para siempre.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    color: "#e5e7eb",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#9ca3af",
    marginBottom: 16,
  },
  card: {
    borderRadius: 16,
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 16,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: "#e5e7eb",
    marginBottom: 8,
  },
  labelSmall: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 12,
    marginBottom: 4,
  },
  levelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  levelButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#374151",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  levelButtonActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#0c4a6e",
  },
  levelText: {
    color: "#e5e7eb",
    fontSize: 14,
  },
  levelTextActive: {
    color: "#e0f2fe",
    fontWeight: "600",
  },
  input: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 70,
    color: "#e5e7eb",
    textAlignVertical: "top",
    backgroundColor: "#020617",
  },
  saveButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: "#0369a1",
    paddingVertical: 10,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#e0f2fe",
    fontSize: 14,
    fontWeight: "600",
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  historyTitle: {
    fontSize: 14,
    color: "#e5e7eb",
    marginBottom: 4,
  },
  historyLoading: {
    fontSize: 11,
    color: "#9ca3af",
  },
  historyList: {
    marginTop: 4,
    marginBottom: 8,
  },
  historyEmpty: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 8,
  },
  historyItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#020617",
  },
  historyLeft: {
    flex: 1,
    marginRight: 8,
  },
  historyDate: {
    fontSize: 12,
    color: "#e5e7eb",
    marginBottom: 2,
  },
  historyNote: {
    fontSize: 12,
    color: "#9ca3af",
  },
  historyBadge: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  historyBadgeLabel: {
    fontSize: 10,
    color: "#9ca3af",
    marginBottom: 4,
  },
  historyBadgeCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#38bdf8",
    alignItems: "center",
    justifyContent: "center",
  },
  historyBadgeValue: {
    color: "#e0f2fe",
    fontSize: 13,
    fontWeight: "600",
  },
  footerText: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 8,
    marginBottom: 24,
  },
});