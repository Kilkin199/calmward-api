import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { sendAIMessage } from "../api/aiApi";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Mode = "LISTEN" | "HELP";

function createId() {
  return Math.random().toString(36).slice(2);
}

export default function ChatScreen() {
  const [mode, setMode] = useState<Mode>("LISTEN");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: text,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const data = await sendAIMessage(text, mode);
      const replyText: string =
        data?.reply ||
        data?.message ||
        data?.content ||
        data?.text ||
        "No he podido generar una respuesta ahora mismo.";

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: replyText,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (e: any) {
      console.log(e);
      setError(
        e?.message ||
          "Ha habido un problema al hablar con el servidor. Revisa tu conexiÃ³n o la URL de la API."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Hablar</Text>
        <Text style={styles.subtitle}>
          Puedes usar este espacio para desahogarte, pensar en voz alta o
          intentar poner en orden lo que llevas dentro.
        </Text>
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            mode === "LISTEN" && styles.modeButtonActive,
          ]}
          onPress={() => setMode("LISTEN")}
        >
          <Text
            style={[
              styles.modeButtonText,
              mode === "LISTEN" && styles.modeButtonTextActive,
            ]}
          >
            Solo escÃºchame
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            mode === "HELP" && styles.modeButtonActive,
          ]}
          onPress={() => setMode("HELP")}
        >
          <Text
            style={[
              styles.modeButtonText,
              mode === "HELP" && styles.modeButtonTextActive,
            ]}
          >
            AyÃºdame a ordenar
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.chatCard}>
        <ScrollView
          style={styles.messages}
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          {messages.length === 0 && (
            <Text style={styles.emptyText}>
              Puedes empezar contÃ¡ndome quÃ© te preocupa hoy, quÃ© se te ha hecho
              cuesta arriba o simplemente cÃ³mo te sientes.
            </Text>
          )}

          {messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.role === "user" ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text style={styles.bubbleText}>{m.content}</Text>
            </View>
          ))}
        </ScrollView>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            multiline
            value={input}
            onChangeText={setInput}
            placeholder="Escribe aquÃ­ lo que quieras compartir..."
            placeholderTextColor="#6b7280"
          />
          <TouchableOpacity
            style={[styles.sendButton, loading && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={loading}
          >
            <Text style={styles.sendButtonText}>
              {loading ? "..." : "Enviar"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.footer}>
        Calmward no da diagnÃ³sticos ni sustituye a profesionales. Si estÃ¡s en
        peligro o muy al lÃ­mite, busca ayuda directa.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  header: {
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    color: "#e5e7eb",
  },
  subtitle: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 8,
  },
  modeButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#020617",
  },
  modeButtonActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#0c4a6e",
  },
  modeButtonText: {
    fontSize: 12,
    color: "#e5e7eb",
  },
  modeButtonTextActive: {
    fontWeight: "600",
    color: "#e0f2fe",
  },
  chatCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#020617",
    padding: 10,
  },
  messages: {
    flex: 1,
  },
  emptyText: {
    fontSize: 12,
    color: "#6b7280",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginVertical: 4,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#0c4a6e",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#111827",
  },
  bubbleText: {
    fontSize: 13,
    color: "#e5e7eb",
  },
  errorText: {
    fontSize: 11,
    color: "#fca5a5",
    marginTop: 4,
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#e5e7eb",
    backgroundColor: "#020617",
    textAlignVertical: "top",
  },
  sendButton: {
    alignSelf: "flex-end",
    height: 36,
    borderRadius: 999,
    backgroundColor: "#0369a1",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: "#e0f2fe",
    fontSize: 12,
    fontWeight: "600",
  },
  footer: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 6,
  },
});