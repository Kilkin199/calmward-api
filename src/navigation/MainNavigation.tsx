// src/navigation/MainNavigation.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useContext,
  useRef,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Linking,
  Alert,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppHeader from "../components/AppHeader";
import { API_BASE_URL, AI_ENABLED } from "../config";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const { width } = Dimensions.get("window");

// ---------- AUTENTICACIÓN / CONTEXTO ----------

type UserGender = "male" | "female" | "other";

type AuthContextType = {
  isLogged: boolean;
  userEmail: string | null;
  userName: string | null;
  userGender: UserGender | null;
  userCountry: string | null;
  isSponsor: boolean;
  sessionTimeoutMinutes: number;
  login: (
    email: string,
    token: string,
    isSponsorFromApi?: boolean,
    profile?: {
      name?: string | null;
      gender?: UserGender | null;
      country?: string | null;
    }
  ) => Promise<void>;
  logout: () => Promise<void>;
  setSponsor: (value: boolean) => Promise<void>;
  setSessionTimeoutMinutes: (minutes: number) => Promise<void>;
};

const AuthContext = React.createContext<AuthContextType>({
  isLogged: false,
  userEmail: null,
  userName: null,
  userGender: null,
  userCountry: null,
  isSponsor: false,
  sessionTimeoutMinutes: 30,
  login: async () => {},
  logout: async () => {},
  setSponsor: async () => {},
  setSessionTimeoutMinutes: async () => {},
});

function useAuth() {
  return useContext(AuthContext);
}

// ---------- DATOS DE PATROCINIOS (CARRUSEL) ----------

type Sponsor = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  cta: string;
  url: string;
};

const SPONSORS: Sponsor[] = [
  {
    id: "mindspace",
    name: "Mindspace Diario",
    tagline: "Cuadernos para escribir lo que no dices en voz alta.",
    description:
      "Marca imaginaria de papelería que apoya proyectos relacionados con el bienestar emocional y el hábito de escribir.",
    cta: "Ejemplo de marca que apoya que Calmward pueda seguir siendo gratuita.",
    url: "https://www.ejemplo.com/mindspace",
  },
  {
    id: "calmtea",
    name: "CalmTea Blends",
    tagline: "Infusiones suaves para ratos de calma.",
    description:
      "Pequeña marca ficticia que se enfoca en momentos tranquilos, rutinas nocturnas y autocuidado sin prisas.",
    cta: "Este espacio podría mostrar beneficios especiales para quienes usan Calmward.",
    url: "https://www.ejemplo.com/calmtea",
  },
  {
    id: "respiraapp",
    name: "RespiraApp Studio",
    tagline: "Proyectos digitales centrados en salud emocional.",
    description:
      "Estudio digital que apoya herramientas que cuidan de la mente, no solo del rendimiento.",
    cta: "Un patrocinio aquí ayuda a mantener la app sin anuncios invasivos.",
    url: "https://www.ejemplo.com/respiraapp",
  },
];

// ---------- FOOTER GLOBAL ----------

function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <View style={styles.footerContainer}>
      <View style={styles.footerLogoRow}>
        <View style={styles.footerLogoCircle}>
          <Text style={styles.footerLogoLetter}>C</Text>
        </View>
        <Text style={styles.footerLogoText}>Calmward</Text>
      </View>
      <Text style={styles.footerCopyright}>
        © {year} Calmward · Bienestar diario
      </Text>
      <Text style={styles.footerTiny}>
        Esta app no sustituye ayuda profesional ni servicios de emergencia.
      </Text>
    </View>
  );
}

// ---------- PANTALLA DE AUTENTICACIÓN (BIENVENIDA + LOGIN/REGISTRO) ----------

function AuthScreen({ navigation }: any) {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");

  const [name, setName] = useState("");
  const [gender, setGender] = useState<UserGender>("other");
  const [country, setCountry] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function genderLabel(g: UserGender) {
    if (g === "male") return "Hombre";
    if (g === "female") return "Mujer";
    return "Otro / Prefiero no decirlo";
  }

  function handleForgotPassword() {
    Alert.alert(
      "Recuperar contraseña",
      "Pronto podrás restablecer tu contraseña desde tu correo directamente desde aquí."
    );
  }

  async function handleSubmit() {
    setError(null);

    if (!email || !password) {
      setError("Rellena el correo y la contraseña.");
      return;
    }

    if (mode === "register") {
      if (!name.trim()) {
        setError("Escribe tu nombre.");
        return;
      }
      if (!country.trim()) {
        setError("Indica tu país.");
        return;
      }
      if (password.length < 10) {
        setError("La contraseña debe tener al menos 10 caracteres.");
        return;
      }
      if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) {
        setError("La contraseña debe incluir al menos una letra mayúscula.");
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint =
        mode === "login" ? "/auth/login" : "/auth/register-and-login";

      let token = "demo-token";
      let isSponsorFromApi: boolean | undefined = undefined;

      if (API_BASE_URL) {
        try {
          const payload: any = { email, password };
          if (mode === "register") {
            payload.name = name.trim();
            payload.gender = gender;
            payload.country = country.trim();
          }

          const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            let msg =
              "No se ha podido iniciar sesión. Revisa correo y contraseña o vuelve a intentarlo.";
            try {
              const data = await res.json();
              if (
                data &&
                typeof data.error === "string" &&
                data.error.trim()
              ) {
                msg = data.error.trim();
              }
            } catch {
              // JSON inválido, usamos el mensaje por defecto
            }
            setError(msg);
            return;
          }

          const data = await res.json();

          if (typeof data.token === "string" && data.token.trim().length > 0) {
            token = data.token.trim();
          }

          if (typeof data.isSponsor === "boolean") {
            isSponsorFromApi = data.isSponsor;
          }
        } catch (e) {
          console.log("Error de red con Calmward API", e);
          setError(
            "No se ha podido conectar con el servidor de Calmward. Revisa tu conexión o inténtalo más tarde."
          );
          return;
        }
      }

      const profile =
        mode === "register"
          ? {
              name: name.trim(),
              gender,
              country: country.trim(),
            }
          : undefined;

      await login(email, token, isSponsorFromApi, profile);
      // No hacemos navigation.replace aquí: al cambiar isLogged, el Stack mostrará Root.
    } catch (e) {
      setError("No se ha podido iniciar sesión, inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.authScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.authHeaderTop}>
          <Text style={styles.appMiniTitle}>Calmward</Text>
        </View>

        <View style={styles.authCard}>
          <Text style={styles.authWelcome}>Bienvenido a Calmward</Text>
          <Text style={styles.authSubtitle}>
            Un lugar discreto para registrar tu día, hablar cuando lo
            necesites y tener a mano ayuda si algo se complica.
          </Text>

          <View style={styles.authTabRow}>
            <TouchableOpacity
              onPress={() => setMode("login")}
              style={[
                styles.authTab,
                mode === "login" && styles.authTabActive,
              ]}
            >
              <Text
                style={[
                  styles.authTabText,
                  mode === "login" && styles.authTabTextActive,
                ]}
              >
                Iniciar sesión
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode("register")}
              style={[
                styles.authTab,
                mode === "register" && styles.authTabActive,
              ]}
            >
              <Text
                style={[
                  styles.authTabText,
                  mode === "register" && styles.authTabTextActive,
                ]}
              >
                Crear cuenta
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.authForm}>
            {mode === "register" && (
              <>
                <Text style={styles.label}>Nombre</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Cómo quieres que te llame la app"
                  placeholderTextColor="#9CA3AF"
                />

                <Text style={[styles.label, { marginTop: 12 }]}>Género</Text>
                <View style={styles.genderRow}>
                  {(["male", "female", "other"] as UserGender[]).map((g) => {
                    const active = gender === g;
                    return (
                      <TouchableOpacity
                        key={g}
                        style={[
                          styles.genderChip,
                          active && styles.genderChipActive,
                        ]}
                        onPress={() => setGender(g)}
                      >
                        <Text
                          style={[
                            styles.genderChipText,
                            active && styles.genderChipTextActive,
                          ]}
                        >
                          {genderLabel(g)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.label, { marginTop: 12 }]}>País</Text>
                <TextInput
                  style={styles.input}
                  value={country}
                  onChangeText={setCountry}
                  placeholder="Ej: España, México, Argentina..."
                  placeholderTextColor="#9CA3AF"
                />
              </>
            )}

            <Text style={[styles.label, { marginTop: 12 }]}>
              Correo electrónico
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              placeholder="tu_correo@example.com"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Contraseña</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder={
                mode === "register"
                  ? "Mínimo 10 caracteres y una mayúscula"
                  : "••••••••"
              }
              placeholderTextColor="#9CA3AF"
            />

            {mode === "login" && (
              <TouchableOpacity
                style={styles.forgotPasswordBtn}
                onPress={handleForgotPassword}
              >
                <Text style={styles.forgotPasswordText}>
                  He olvidado mi contraseña
                </Text>
              </TouchableOpacity>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleSubmit}
              disabled={loading}
            >
              <Text style={styles.primaryButtonText}>
                {loading
                  ? "Procesando..."
                  : mode === "login"
                  ? "Iniciar sesión"
                  : "Crear cuenta"}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.disclaimer}>
            Calmward no sustituye ayuda profesional ni servicios de emergencia.
            En caso de peligro inmediato, contacta con los servicios de
            emergencia de tu país.
          </Text>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- TAB: INICIO ----------

function HomeScreen({ navigation }: any) {
  const { isLogged, isSponsor } = useAuth();
  const [sponsorIndex, setSponsorIndex] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const CARD_WIDTH = width * 0.8;
  const CARD_SPACING = 12;

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {
      // ignoramos
    }
  }

  useEffect(() => {
    if (SPONSORS.length <= 1) return;
    const intervalId = setInterval(() => {
      const fullWidth = CARD_WIDTH + CARD_SPACING;
      setSponsorIndex((prev) => {
        const next = (prev + 1) % SPONSORS.length;
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            x: next * fullWidth,
            animated: true,
          });
        }
        return next;
      });
    }, 8000);
    return () => clearInterval(intervalId);
  }, [CARD_WIDTH]);

  function handleScrollEnd(e: any) {
    const fullWidth = CARD_WIDTH + CARD_SPACING;
    const offsetX = e.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / fullWidth);
    const safeIndex = Math.max(0, Math.min(index, SPONSORS.length - 1));
    setSponsorIndex(safeIndex);
  }

  async function handleSponsorOpen(sponsor: Sponsor) {
    await touchActivity();
    if (!sponsor.url) {
      Alert.alert(
        "Patrocinio sin enlace",
        "Este patrocinio todavía no tiene un enlace configurado."
      );
      return;
    }
    Linking.openURL(sponsor.url).catch(() => {
      Alert.alert(
        "No se pudo abrir el enlace",
        "Revisa que la URL del patrocinio es correcta."
      );
    });
  }

  async function handleSponsorPayment() {
    await touchActivity();

    const parentNav = navigation.getParent?.() || navigation;

    if (!isLogged) {
      parentNav.navigate("Auth");
      return;
    }

    parentNav.navigate("SponsorPayment");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* BLOQUE DE PATROCINIOS ARRIBA */}
        <View style={[styles.sectionCard, styles.sponsorCard]}>
          <View style={styles.sponsorHeaderRow}>
            <Text style={styles.sponsorBadge}>Patrocinado</Text>
            <Text style={styles.sponsorMiniText}>
              Ayudan a que Calmward siga siendo gratuita
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_WIDTH + CARD_SPACING}
            decelerationRate="fast"
            onMomentumScrollEnd={handleScrollEnd}
            contentContainerStyle={{ paddingRight: 4 }}
          >
            {SPONSORS.map((s, idx) => (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.9}
                style={[
                  styles.sponsorItemCard,
                  {
                    width: CARD_WIDTH,
                    marginRight:
                      idx === SPONSORS.length - 1 ? 0 : CARD_SPACING,
                  },
                ]}
                onPress={() => handleSponsorOpen(s)}
              >
                <Text style={styles.sponsorName}>{s.name}</Text>
                <Text style={styles.sponsorTagline}>{s.tagline}</Text>
                <Text style={styles.sponsorSmall}>{s.description}</Text>
                <Text style={styles.sponsorCta}>{s.cta}</Text>
                <Text style={styles.sponsorLinkHint}>
                  Toca para ir a su enlace
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.sponsorDotsRow}>
            {SPONSORS.map((s, idx) => (
              <View
                key={s.id}
                style={[
                  styles.sponsorDot,
                  idx === sponsorIndex && styles.sponsorDotActive,
                ]}
              />
            ))}
          </View>
        </View>

        {/* BLOQUE: QUÉ ES CALMWARD */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Qué es Calmward</Text>
          <Text style={styles.sectionBody}>
            Calmward es una app pensada para acompañarte en días buenos,
            regulares y malos. No sustituye a profesionales ni a servicios de
            emergencia, pero sí quiere ser un lugar seguro donde:
          </Text>
          <Text style={styles.sectionBody}>
            • Registrar cómo te sientes a lo largo del tiempo.{"\n"}
            • Escribir lo que te cuesta decir en voz alta.{"\n"}
            • Hablar con una IA que responde con cuidado, sin juzgarte.{"\n"}
            • Tener a mano recordatorios de que pedir ayuda no es un fracaso.
          </Text>
          <Text style={styles.sectionBody}>
            La idea es que, al abrir Calmward, no te sientas solo con lo que
            estás llevando encima.
          </Text>
        </View>

        {/* BLOQUE: PATROCINA CALMWARD / PAGO */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Patrocina Calmward</Text>
          <Text style={styles.sectionBody}>
            Los patrocinios permiten que la app pueda seguir siendo gratuita y
            sin anuncios invasivos. A cambio, tu marca aparece en el bloque de
            patrocinios de la pantalla de inicio.
          </Text>
          <Text style={styles.sectionBody}>
            Si contratas un patrocinio, en tu cuenta verás un apartado de
            estadísticas con datos básicos de visualizaciones e interacciones
            (pensado para conectar con un backend más adelante).
          </Text>

          {isSponsor ? (
            <Text style={[styles.sectionBody, { marginTop: 8 }]}>
              Tu cuenta ya está marcada como patrocinador activo. Puedes ver tus
              estadísticas desde tu perfil.
            </Text>
          ) : (
            <Text style={[styles.sectionBody, { marginTop: 8 }]}>
              Para patrocinar Calmward necesitas tener una cuenta y haber
              iniciado sesión.
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.sponsorPayButton,
              !isLogged && styles.sponsorPayButtonDisabled,
            ]}
            onPress={handleSponsorPayment}
          >
            <Text style={styles.sponsorPayButtonText}>
              {isLogged ? "Ir a página de pago" : "Inicia sesión para patrocinar"}
            </Text>
          </TouchableOpacity>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- TAB: HABLAR (CHAT) ----------

type ChatMessage = {
  id: string;
  from: "user" | "ai";
  text: string;
};

function TalkScreen({ navigation }: any) {
  const { userName, userGender, userCountry } = useAuth();
  const [mode, setMode] = useState<"listen" | "organize">("listen");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const [messagesListen, setMessagesListen] = useState<ChatMessage[]>([]);
  const [messagesOrganize, setMessagesOrganize] = useState<ChatMessage[]>([]);

  const activeMessages =
    mode === "listen" ? messagesListen : messagesOrganize;

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {
      // ignoramos
    }
  }

  function getModeConfig() {
    if (mode === "listen") {
      return {
        list: messagesListen,
        setter: setMessagesListen,
        apiMode: "solo_escuchame" as const,
      };
    }
    return {
      list: messagesOrganize,
      setter: setMessagesOrganize,
      apiMode: "ayudame_a_ordenar" as const,
    };
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    await touchActivity();

    const { list, setter, apiMode } = getModeConfig();

    const userMsg: ChatMessage = {
      id: Date.now().toString() + "-u",
      from: "user",
      text: trimmed,
    };

    setText("");

    const updatedList = [...list, userMsg];
    setter(updatedList);

    if (!AI_ENABLED || !API_BASE_URL) {
      const aiMsg: ChatMessage = {
        id: Date.now().toString() + "-a",
        from: "ai",
        text:
          "Ahora mismo la IA remota no está configurada correctamente en Calmward. " +
          "Revisa la URL de API_BASE_URL en config.ts.",
      };
      setter((prev) => [...prev, aiMsg]);
      return;
    }

    setSending(true);

    let replyText = "";

    try {
      const history = updatedList.map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      }));

      const userProfile =
        userName || userGender || userCountry
          ? {
              name: userName,
              gender: userGender,
              country: userCountry,
            }
          : undefined;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`${API_BASE_URL}/ai/talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: apiMode,
          message: trimmed,
          history,
          userProfile,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.reply === "string" && data.reply.trim()) {
          replyText = data.reply.trim();
        } else if (
          data &&
          typeof data.message === "string" &&
          data.message.trim()
        ) {
          replyText = data.message.trim();
        } else {
          console.log("Respuesta IA sin 'reply' claro:", data);
        }
      } else {
        console.log("IA /ai/talk devolvió error HTTP", res.status);
      }
    } catch (err) {
      console.log("Error/timeout IA con contexto, uso respuesta local.", err);
    } finally {
      setSending(false);
    }

    if (!replyText) {
      replyText =
        "No he podido obtener respuesta del servidor de Calmward ahora mismo. " +
        "Inténtalo otra vez en unos minutos.";
    }

    const aiMsg: ChatMessage = {
      id: Date.now().toString() + "-a",
      from: "ai",
      text: replyText,
    };

    setter((prev) => [...prev, aiMsg]);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Hablar</Text>
            <Text style={styles.sectionBody}>
              Aquí puedes desahogarte o intentar ordenar lo que sientes. Tú
              eliges el modo.
            </Text>

            <View style={styles.modeRow}>
              <TouchableOpacity
                onPress={() => setMode("listen")}
                style={[
                  styles.modeButton,
                  mode === "listen" && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    mode === "listen" && styles.modeButtonTextActive,
                  ]}
                >
                  Solo escúchame
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMode("organize")}
                style={[
                  styles.modeButton,
                  mode === "organize" && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    mode === "organize" && styles.modeButtonTextActive,
                  ]}
                >
                  Ayúdame a ordenar
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.chatBox}>
              {activeMessages.map((m) => (
                <View
                  key={m.id}
                  style={[
                    styles.chatBubble,
                    m.from === "user"
                      ? styles.chatBubbleUser
                      : styles.chatBubbleAi,
                  ]}
                >
                  <Text
                    style={
                      m.from === "user"
                        ? styles.chatTextUser
                        : styles.chatTextAi
                    }
                  >
                    {m.text}
                  </Text>
                </View>
              ))}

              {activeMessages.length === 0 && (
                <Text style={styles.chatPlaceholder}>
                  {mode === "listen"
                    ? "Habla conmigo como con un amigo de confianza. Puedes empezar por cómo te sientes hoy o qué te está costando más."
                    : "Aquí la IA intentará ayudarte a poner orden: decisiones, problemas que se te hacen bola, siguientes pasos pequeños…"}
                </Text>
              )}
            </View>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder={
                  mode === "listen"
                    ? "Dime cómo estás, aunque no tengas las palabras perfectas..."
                    : "Cuéntame qué quieres ordenar o qué decisión se te hace difícil ahora mismo..."
                }
                placeholderTextColor="#9CA3AF"
                multiline
                value={text}
                onChangeText={setText}
              />
              <TouchableOpacity
                style={styles.sendButton}
                onPress={handleSend}
                disabled={sending}
              >
                <Text style={styles.sendButtonText}>
                  {sending ? "..." : "Enviar"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.disclaimerSmall}>
              Calmward no sustituye a profesionales de salud mental ni puede
              responder en situaciones de emergencia.
            </Text>
          </View>

          <AppFooter />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------- TAB: TU DÍA ----------

function DayScreen({ navigation }: any) {
  const [rating, setRating] = useState<number>(3);
  const [note, setNote] = useState("");

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  async function saveDay() {
    try {
      await touchActivity();
      const existingRaw = await AsyncStorage.getItem("calmward_days");
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const newItem = {
        id: Date.now(),
        date: new Date().toISOString(),
        rating,
        note,
      };
      const updated = [newItem, ...existing];
      await AsyncStorage.setItem("calmward_days", JSON.stringify(updated));
      setNote("");
      Alert.alert("Día guardado", "Tu día se ha guardado correctamente.");
    } catch (e) {
      Alert.alert("Error", "No se ha podido guardar el día.");
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Tu día</Text>
          <Text style={styles.sectionBody}>
            Marca cómo estás y deja una nota si te ayuda. Calmward irá
            guardando tu historia.
          </Text>

          <Text style={[styles.label, { marginTop: 12 }]}>
            ¿Cómo te sientes ahora mismo?
          </Text>

          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity
                key={v}
                style={[
                  styles.ratingCircle,
                  rating === v && styles.ratingCircleActive,
                ]}
                onPress={() => setRating(v)}
              >
                <Text
                  style={[
                    styles.ratingText,
                    rating === v && styles.ratingTextActive,
                  ]}
                >
                  {v}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>
            ¿Quieres añadir algo?
          </Text>
          <TextInput
            style={styles.dayInput}
            placeholder="Escribe algo corto si te apetece..."
            placeholderTextColor="#9CA3AF"
            multiline
            value={note}
            onChangeText={setNote}
          />

          <TouchableOpacity style={styles.daySaveBtn} onPress={saveDay}>
            <Text style={styles.daySaveText}>Guardar día de hoy</Text>
          </TouchableOpacity>

          <View style={styles.dayTabsRow}>
            <TouchableOpacity style={styles.dayTabActive}>
              <Text style={styles.dayTabActiveText}>Lista</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dayTab}>
              <Text style={styles.dayTabText}>Resumen</Text>
            </TouchableOpacity>
          </View>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- PERFIL ----------

function ProfileScreen({ navigation }: any) {
  const { userEmail, userName, userGender, userCountry, logout, isSponsor } =
    useAuth();

  async function handleLogout() {
    await logout();
  }

  function goToSponsorStats() {
    if (!isSponsor) return;
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("SponsorStats");
  }

  function genderLabel() {
    if (userGender === "male") return "Hombre";
    if (userGender === "female") return "Mujer";
    if (userGender === "other") return "Otro / Prefiero no decirlo";
    return "No indicado";
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Perfil</Text>
          {userEmail ? (
            <>
              <Text style={styles.sectionBody}>Correo: {userEmail}</Text>
              <Text style={styles.sectionBody}>
                Nombre: {userName || "No indicado"}
              </Text>
              <Text style={styles.sectionBody}>Género: {genderLabel()}</Text>
              <Text style={styles.sectionBody}>
                País: {userCountry || "No indicado"}
              </Text>
            </>
          ) : (
            <Text style={styles.sectionBody}>
              No hay sesión activa en este momento.
            </Text>
          )}

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Patrocinio</Text>
          {isSponsor ? (
            <>
              <Text style={styles.sectionBody}>
                Tu cuenta está marcada como patrocinador activo de Calmward.
              </Text>
              <Text style={styles.sectionBody}>
                Aquí podrás consultar datos básicos de visualizaciones y clics
                de tu patrocinio cuando haya un backend conectado.
              </Text>
              <TouchableOpacity
                style={styles.sponsorStatsBtn}
                onPress={goToSponsorStats}
              >
                <Text style={styles.sponsorStatsBtnText}>
                  Ver estadísticas de patrocinio
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.sectionBody}>
              De momento tu cuenta no tiene un patrocinio activo. Puedes ver
              cómo patrocinar Calmward desde la pantalla Inicio.
            </Text>
          )}
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- CONTACTO ----------

function ContactScreen({ navigation }: any) {
  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  async function handleEmail() {
    await touchActivity();
    Linking.openURL("mailto:soporte@calmward.app").catch(() => {
      Alert.alert(
        "No se pudo abrir el correo",
        "Copia la dirección soporte@calmward.app y escribe desde tu gestor de correo."
      );
    });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Contacto</Text>
          <Text style={styles.sectionBody}>
            Si quieres escribirnos por dudas, propuestas de colaboración o
            patrocinios, puedes hacerlo aquí:
          </Text>
          <Text style={[styles.sectionBody, { marginTop: 8 }]}>
            Correo de contacto:{" "}
            <Text style={{ fontWeight: "600" }}>soporte@calmward.app</Text>
          </Text>

          <TouchableOpacity style={styles.contactBtn} onPress={handleEmail}>
            <Text style={styles.contactBtnText}>Enviar correo</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionBody, { marginTop: 16 }]}>
            Recuerda que Calmward no ofrece atención de crisis ni sustitución
            de servicios de emergencia. Si estás en peligro o crees que
            podrías hacerte daño, contacta con los servicios de emergencia de
            tu país.
          </Text>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- POLÍTICA DE PRIVACIDAD ----------

function LegalScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Política de privacidad</Text>
          <Text style={styles.sectionBody}>
            Calmward es una aplicación pensada para el bienestar emocional y el
            registro personal. No está diseñada para situaciones de emergencia
            ni sustituye la ayuda de profesionales de salud mental.
            {"\n\n"}
            Los datos básicos de tu cuenta (como el correo electrónico) se
            utilizan únicamente para gestionar tu sesión y no se venden a
            terceros. Tus anotaciones personales, estados de ánimo y mensajes
            dentro de la app están pensados para tu propio uso y no deben
            considerarse un historial clínico.
            {"\n\n"}
            Si en el futuro conectas Calmward con algún servicio externo
            (terapeutas, plataformas de vídeo, pasarelas de pago, etc.),
            siempre se te informará de forma clara de qué datos se comparten y
            con qué objetivo.
            {"\n\n"}
            En cualquier momento puedes dejar de usar la aplicación y eliminarla
            de tu dispositivo. Antes de publicar la app en tiendas oficiales,
            te recomendamos revisar esta política con un profesional legal para
            adaptarla a las leyes de tu país (por ejemplo, RGPD en la Unión
            Europea u otras normativas locales).
          </Text>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- ESTADÍSTICAS DE PATROCINIO ----------

function SponsorStatsScreen({ navigation }: any) {
  const { isSponsor } = useAuth();

  useEffect(() => {
    if (!isSponsor) {
      Alert.alert(
        "Sin patrocinio",
        "Esta sección está disponible solo para cuentas patrocinadoras."
      );
    }
  }, [isSponsor]);

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Estadísticas de patrocinio</Text>
          {isSponsor ? (
            <>
              <Text style={styles.sectionBody}>
                Estos datos son de ejemplo. Cuando se conecte un backend real,
                aquí verás las estadísticas de tu patrocinio.
              </Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>Impresiones</Text>
                  <Text style={styles.summaryValue}>0</Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>Clics estimados</Text>
                  <Text style={styles.summaryValue}>0</Text>
                </View>
              </View>
              <Text style={[styles.sectionBody, { marginTop: 12 }]}>
                La idea es que puedas ver cuánta gente ve tu tarjeta en el
                carrusel de inicio y cuántos tocan tu enlace o CTA.
              </Text>
            </>
          ) : (
            <Text style={styles.sectionBody}>
              Tu cuenta no tiene un patrocinio activo. Vuelve atrás y revisa
              la pantalla de Inicio para ver cómo patrocinar Calmward.
            </Text>
          )}
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- PAGO DE PATROCINIO ----------

function SponsorPaymentScreen({ navigation }: any) {
  const { userEmail, setSponsor } = useAuth();
  const [brandName, setBrandName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "card" | "paypal" | "other"
  >("card");
  const [processing, setProcessing] = useState(false);

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  async function handleConfirm() {
    await touchActivity();

    if (!brandName.trim() || !websiteUrl.trim()) {
      Alert.alert(
        "Faltan datos",
        "Añade al menos el nombre de la marca y el enlace web o de app."
      );
      return;
    }

    setProcessing(true);
    try {
      await setSponsor(true);
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );

      Alert.alert(
        "Patrocinio activado",
        "Simulación de pago completada. Tu cuenta se ha marcado como patrocinador de Calmward."
      );

      const parent = navigation.getParent?.() || navigation;
      parent.navigate("SponsorStats");
    } catch (e) {
      Alert.alert(
        "Error",
        "No se ha podido completar el proceso de patrocinio. Inténtalo de nuevo más tarde."
      );
    } finally {
      setProcessing(false);
    }
  }

  function PaymentOption({
    label,
    value,
  }: {
    label: string;
    value: "card" | "paypal" | "other";
  }) {
    const active = paymentMethod === value;
    return (
      <TouchableOpacity
        style={[
          styles.paymentMethodButton,
          active && styles.paymentMethodButtonActive,
        ]}
        onPress={() => setPaymentMethod(value)}
      >
        <Text
          style={[
            styles.paymentMethodText,
            active && styles.paymentMethodTextActive,
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Patrocinio Calmward</Text>
          <Text style={styles.sectionBody}>
            Aquí configuras tu patrocinio. Los pagos de esta pantalla son una
            simulación hasta que conectes una pasarela real (Stripe, PayPal,
            etc.).
          </Text>

          <Text style={[styles.label, { marginTop: 12 }]}>
            Correo de la cuenta
          </Text>
          <Text style={styles.sectionBody}>
            {userEmail || "No hay correo asociado"}
          </Text>

          <Text style={[styles.label, { marginTop: 12 }]}>Nombre de marca</Text>
          <TextInput
            style={styles.input}
            value={brandName}
            onChangeText={setBrandName}
            placeholder="Ej: Mindspace Diario"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={[styles.label, { marginTop: 12 }]}>
            Enlace web o de app
          </Text>
          <TextInput
            style={styles.input}
            value={websiteUrl}
            onChangeText={setWebsiteUrl}
            placeholder="https://tu-sitio-o-app.com"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={[styles.label, { marginTop: 12 }]}>
            Mensaje corto (opcional)
          </Text>
          <TextInput
            style={styles.dayInput}
            value={tagline}
            onChangeText={setTagline}
            placeholder="Una frase corta sobre tu marca..."
            placeholderTextColor="#9CA3AF"
            multiline
          />

          <Text style={[styles.sectionBody, { marginTop: 16 }]}>
            Método de pago (simulado)
          </Text>
          <View style={styles.paymentMethodRow}>
            <PaymentOption label="Tarjeta / Visa" value="card" />
            <PaymentOption label="PayPal" value="paypal" />
            <PaymentOption label="Otro" value="other" />
          </View>

          <Text style={[styles.sectionBody, { marginTop: 12 }]}>
            Al confirmar, tu cuenta se marca como patrocinador dentro de
            Calmward y podrás ver un panel de estadísticas interno. Para
            producción, conecta aquí tu pasarela de pago real.
          </Text>

          <TouchableOpacity
            style={styles.paymentConfirmButton}
            onPress={handleConfirm}
            disabled={processing}
          >
            <Text style={styles.paymentConfirmButtonText}>
              {processing ? "Procesando..." : "Confirmar pago (simulado)"}
            </Text>
          </TouchableOpacity>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- CONFIGURACIÓN DE CUENTA ----------

function SettingsScreen({ navigation }: any) {
  const { userEmail, sessionTimeoutMinutes, setSessionTimeoutMinutes } =
    useAuth();

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  async function handleSelectTimeout(minutes: number) {
    await touchActivity();
    await setSessionTimeoutMinutes(minutes);
  }

  function timeoutLabel(minutes: number) {
    if (minutes === 0) return "Nunca";
    return `${minutes} min`;
  }

  const options = [15, 30, 60, 120, 0];

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Configuración de la cuenta</Text>
          <Text style={styles.sectionBody}>
            Aquí puedes ajustar algunas opciones básicas de tu cuenta Calmward.
          </Text>

          <Text style={[styles.label, { marginTop: 12 }]}>
            Correo de la cuenta
          </Text>
          <Text style={styles.sectionBody}>
            {userEmail || "No hay sesión activa."}
          </Text>

          <Text style={[styles.label, { marginTop: 16 }]}>
            Cierre de sesión por inactividad
          </Text>
          <Text style={styles.settingsHint}>
            Si no usas la app durante este tiempo, la sesión se cerrará para
            proteger tu privacidad. El valor por defecto es 30 minutos.
          </Text>

          <View style={styles.settingsOptionsRow}>
            {options.map((opt) => {
              const active = sessionTimeoutMinutes === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.settingsOptionButton,
                    active && styles.settingsOptionButtonActive,
                  ]}
                  onPress={() => handleSelectTimeout(opt)}
                >
                  <Text
                    style={[
                      styles.settingsOptionText,
                      active && styles.settingsOptionTextActive,
                    ]}
                  >
                    {timeoutLabel(opt)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- AYUDA URGENTE ----------

function UrgentHelpScreen({ navigation }: any) {
  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  async function handleHelpPhones() {
    await touchActivity();
    Alert.alert(
      "Teléfonos de ayuda",
      "En la versión final podrás ver aquí teléfonos de ayuda emocional de tu país."
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.sectionCard, styles.urgentMainCard]}>
          <Text style={styles.urgentBigTitle}>Ayuda urgente</Text>
          <Text style={styles.urgentBody}>
            Calmward no es un servicio de emergencias ni puede responder en
            tiempo real.
          </Text>

          <Text style={[styles.urgentBody, { marginTop: 12 }]}>
            Si estás en peligro inmediato o sientes que podrías hacerte daño,
            intenta:
          </Text>

          <Text style={styles.urgentList}>
            • Llamar a los servicios de emergencias de tu país.{"\n"}
            • Contactar con un familiar, amigo o persona de confianza.{"\n"}
            • Buscar líneas de ayuda emocional o de prevención del suicidio en
            tu zona.
          </Text>

          <TouchableOpacity
            style={styles.urgentButtonBig}
            onPress={handleHelpPhones}
          >
            <Text style={styles.urgentButtonBigText}>
              Buscar teléfonos de ayuda
            </Text>
          </TouchableOpacity>

          <Text style={[styles.urgentBody, { marginTop: 16 }]}>
            También puedes usar Calmward para:
          </Text>
          <Text style={styles.urgentList}>
            • Dejar por escrito lo que te está pasando ahora mismo.{"\n"}
            • Preparar lo que quieres decir antes de hablar con alguien.{"\n"}
            • Apuntar pequeñas cosas que te ayuden un poco hoy.
          </Text>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- TABS PRINCIPALES ----------

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#0EA5E9",
        tabBarInactiveTintColor: "#6B7280",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E5E7EB",
        },
        tabBarIcon: ({ color, size }) => {
          let icon = "home-outline";

          if (route.name === "Inicio") icon = "home-outline";
          if (route.name === "Tu día") icon = "white-balance-sunny";
          if (route.name === "Hablar") icon = "message-text-outline";
          if (route.name === "Perfil") icon = "account-circle-outline";
          if (route.name === "Ayuda urgente") icon = "alert-circle-outline";

          return (
            <MaterialCommunityIcons
              name={icon as any}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen name="Inicio" component={HomeScreen} />
      <Tab.Screen name="Tu día" component={DayScreen} />
      <Tab.Screen name="Hablar" component={TalkScreen} />
      <Tab.Screen name="Perfil" component={ProfileScreen} />
      <Tab.Screen name="Ayuda urgente" component={UrgentHelpScreen} />
    </Tab.Navigator>
  );
}

// ---------- NAVEGACIÓN RAÍZ + CONTEXTO AUTH ----------

export default function MainNavigation() {
  const [ready, setReady] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userGender, setUserGender] = useState<UserGender | null>(null);
  const [userCountry, setUserCountry] = useState<string | null>(null);
  const [isSponsor, setIsSponsorState] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutesState] = useState(30);

  useEffect(() => {
    async function load() {
      try {
        const token = await AsyncStorage.getItem("calmward_token");
        const email = await AsyncStorage.getItem("calmward_email");
        const name = await AsyncStorage.getItem("calmward_name");
        const gender = await AsyncStorage.getItem("calmward_gender");
        const country = await AsyncStorage.getItem("calmward_country");
        const sponsorFlag = await AsyncStorage.getItem("calmward_is_sponsor");
        const timeoutStr = await AsyncStorage.getItem(
          "calmward_session_timeout_minutes"
        );

        setIsLogged(!!token);
        setUserEmail(email);
        setUserName(name || null);

        if (gender === "male" || gender === "female" || gender === "other") {
          setUserGender(gender);
        } else {
          setUserGender(null);
        }

        setUserCountry(country || null);
        setIsSponsorState(sponsorFlag === "1");

        if (timeoutStr) {
          const parsed = parseInt(timeoutStr, 10);
          if (!isNaN(parsed) && parsed >= 0) {
            setSessionTimeoutMinutesState(parsed);
          }
        }
      } catch (e) {
        setIsLogged(false);
        setUserEmail(null);
        setUserName(null);
        setUserGender(null);
        setUserCountry(null);
        setIsSponsorState(false);
        setSessionTimeoutMinutesState(30);
      } finally {
        setReady(true);
      }
    }
    load();
  }, []);

  // Auto logout por inactividad
  useEffect(() => {
    if (!isLogged) return;

    const id = setInterval(async () => {
      try {
        const lastStr = await AsyncStorage.getItem("calmward_last_activity");
        if (!lastStr) return;
        const last = parseInt(lastStr, 10);
        if (!last) return;
        if (sessionTimeoutMinutes <= 0) return;

        const diff = Date.now() - last;
        if (diff > sessionTimeoutMinutes * 60 * 1000) {
          await AsyncStorage.removeItem("calmward_token");
          await AsyncStorage.removeItem("calmward_email");
          await AsyncStorage.removeItem("calmward_is_sponsor");
          await AsyncStorage.removeItem("calmward_name");
          await AsyncStorage.removeItem("calmward_gender");
          await AsyncStorage.removeItem("calmward_country");
          setIsLogged(false);
          setUserEmail(null);
          setUserName(null);
          setUserGender(null);
          setUserCountry(null);
          setIsSponsorState(false);
        }
      } catch {
        // ignoramos
      }
    }, 60000);

    return () => clearInterval(id);
  }, [isLogged, sessionTimeoutMinutes]);

  const authContext = useMemo<AuthContextType>(
    () => ({
      isLogged,
      userEmail,
      userName,
      userGender,
      userCountry,
      isSponsor,
      sessionTimeoutMinutes,
      login: async (
        email: string,
        token: string,
        sponsorFlag?: boolean,
        profile?: {
          name?: string | null;
          gender?: UserGender | null;
          country?: string | null;
        }
      ) => {
        await AsyncStorage.setItem("calmward_token", token);
        await AsyncStorage.setItem("calmward_email", email);
        await AsyncStorage.setItem(
          "calmward_last_activity",
          String(Date.now())
        );

        if (typeof sponsorFlag === "boolean") {
          await AsyncStorage.setItem(
            "calmward_is_sponsor",
            sponsorFlag ? "1" : "0"
          );
          setIsSponsorState(sponsorFlag);
        }

        if (profile) {
          const safeName = profile.name ? profile.name.trim() : "";
          const safeCountry = profile.country ? profile.country.trim() : "";
          const g = profile.gender;

          if (safeName) {
            await AsyncStorage.setItem("calmward_name", safeName);
            setUserName(safeName);
          } else {
            await AsyncStorage.removeItem("calmward_name");
            setUserName(null);
          }

          if (safeCountry) {
            await AsyncStorage.setItem("calmward_country", safeCountry);
            setUserCountry(safeCountry);
          } else {
            await AsyncStorage.removeItem("calmward_country");
            setUserCountry(null);
          }

          if (g === "male" || g === "female" || g === "other") {
            await AsyncStorage.setItem("calmward_gender", g);
            setUserGender(g);
          } else {
            await AsyncStorage.removeItem("calmward_gender");
            setUserGender(null);
          }
        }

        setIsLogged(true);
        setUserEmail(email);
      },
      logout: async () => {
        await AsyncStorage.removeItem("calmward_token");
        await AsyncStorage.removeItem("calmward_email");
        await AsyncStorage.removeItem("calmward_is_sponsor");
        await AsyncStorage.removeItem("calmward_last_activity");
        await AsyncStorage.removeItem("calmward_name");
        await AsyncStorage.removeItem("calmward_gender");
        await AsyncStorage.removeItem("calmward_country");
        setIsLogged(false);
        setUserEmail(null);
        setUserName(null);
        setUserGender(null);
        setUserCountry(null);
        setIsSponsorState(false);
      },
      setSponsor: async (value: boolean) => {
        await AsyncStorage.setItem("calmward_is_sponsor", value ? "1" : "0");
        setIsSponsorState(value);
      },
      setSessionTimeoutMinutes: async (minutes: number) => {
        const safe = minutes < 0 ? 0 : minutes;
        await AsyncStorage.setItem(
          "calmward_session_timeout_minutes",
          String(safe)
        );
        setSessionTimeoutMinutesState(safe);
      },
    }),
    [
      isLogged,
      userEmail,
      userName,
      userGender,
      userCountry,
      isSponsor,
      sessionTimeoutMinutes,
    ]
  );

  if (!ready) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#0EA5E9" />
      </SafeAreaView>
    );
  }

  return (
    <AuthContext.Provider value={authContext}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isLogged ? (
          <>
            <Stack.Screen name="Root" component={AppTabs} />
            <Stack.Screen name="Contacto" component={ContactScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
            <Stack.Screen name="SponsorStats" component={SponsorStatsScreen} />
            <Stack.Screen
              name="SponsorPayment"
              component={SponsorPaymentScreen}
            />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Auth" component={AuthScreen} />
            <Stack.Screen name="Contacto" component={ContactScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
          </>
        )}
      </Stack.Navigator>
    </AuthContext.Provider>
  );
}

// ---------- ESTILOS ----------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: "#6B7280",
  },
  sectionBody: {
    fontSize: 14,
    color: "#4B5563",
    marginTop: 4,
  },
  sessionText: {
    marginTop: 8,
    fontSize: 13,
    color: "#6B7280",
  },
  // Footer
  footerContainer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    alignItems: "center",
  },
  footerLogoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  footerLogoCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  footerLogoLetter: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  footerLogoText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  footerCopyright: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  footerTiny: {
    marginTop: 2,
    fontSize: 10,
    color: "#9CA3AF",
    textAlign: "center",
  },
  // Auth
  authScroll: {
    padding: 16,
    paddingBottom: 32,
  },
  authHeaderTop: {
    alignItems: "center",
    marginBottom: 16,
  },
  appMiniTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  appMiniTagline: {
    fontSize: 13,
    color: "#6B7280",
  },
  authCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  authWelcome: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  authSubtitle: {
    fontSize: 14,
    color: "#4B5563",
    marginBottom: 16,
  },
  authTabRow: {
    flexDirection: "row",
    marginBottom: 12,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    padding: 4,
  },
  authTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: "center",
  },
  authTabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  authTabText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  authTabTextActive: {
    color: "#111827",
  },
  authForm: {
    marginTop: 4,
  },
  label: {
    fontSize: 13,
    color: "#4B5563",
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: "#0EA5E9",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  disclaimer: {
    marginTop: 16,
    fontSize: 12,
    color: "#6B7280",
  },
  errorText: {
    marginTop: 8,
    fontSize: 12,
    color: "#DC2626",
  },
  genderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  genderChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#F9FAFB",
  },
  genderChipActive: {
    borderColor: "#0EA5E9",
    backgroundColor: "#E0F2FE",
  },
  genderChipText: {
    fontSize: 12,
    color: "#4B5563",
  },
  genderChipTextActive: {
    color: "#0369A1",
    fontWeight: "600",
  },
  forgotPasswordBtn: {
    alignSelf: "flex-end",
    marginTop: 6,
  },
  forgotPasswordText: {
    fontSize: 12,
    color: "#0EA5E9",
    fontWeight: "500",
  },
  // Talk
  modeRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  modeButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#F9FAFB",
  },
  modeButtonActive: {
    backgroundColor: "#F97316",
    borderColor: "#F97316",
  },
  modeButtonText: {
    fontSize: 13,
    color: "#4B5563",
    fontWeight: "500",
  },
  modeButtonTextActive: {
    color: "#FFFFFF",
  },
  chatBox: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    padding: 10,
    minHeight: 120,
  },
  chatPlaceholder: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  chatBubble: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    maxWidth: "100%",
  },
  chatBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#0EA5E9",
  },
  chatBubbleAi: {
    alignSelf: "flex-start",
    backgroundColor: "#E5E7EB",
  },
  chatTextUser: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  chatTextAi: {
    color: "#111827",
    fontSize: 14,
  },
  inputRow: {
    flexDirection: "row",
    marginTop: 10,
    gap: 8,
    alignItems: "flex-end",
  },
  chatInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    fontSize: 14,
    color: "#111827",
  },
  sendButton: {
    backgroundColor: "#0EA5E9",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  disclaimerSmall: {
    marginTop: 10,
    fontSize: 11,
    color: "#9CA3AF",
  },
  // Day
  ratingRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 10,
  },
  ratingCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  ratingCircleActive: {
    backgroundColor: "#22C55E",
    borderColor: "#22C55E",
  },
  ratingText: {
    fontSize: 16,
    color: "#6B7280",
    fontWeight: "500",
  },
  ratingTextActive: {
    color: "#FFFFFF",
  },
  dayInput: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 70,
    backgroundColor: "#FFFFFF",
    fontSize: 14,
    color: "#111827",
  },
  daySaveBtn: {
    marginTop: 12,
    backgroundColor: "#22C55E",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  daySaveText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  dayTabsRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 8,
  },
  dayTabActive: {
    flex: 1,
    backgroundColor: "#0EA5E9",
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: "center",
  },
  dayTabActiveText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  dayTab: {
    flex: 1,
    backgroundColor: "#E5E7EB",
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: "center",
  },
  dayTabText: {
    color: "#111827",
    fontWeight: "500",
  },
  // Perfil
  logoutBtn: {
    marginTop: 20,
    backgroundColor: "#F97373",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  logoutText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  sponsorStatsBtn: {
    marginTop: 12,
    backgroundColor: "#0EA5E9",
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  sponsorStatsBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Urgente
  urgentMainCard: {
    borderLeftWidth: 4,
    borderLeftColor: "#DC2626",
  },
  urgentBigTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#B91C1C",
    marginBottom: 8,
  },
  urgentBody: {
    fontSize: 14,
    color: "#4B5563",
  },
  urgentList: {
    fontSize: 14,
    color: "#4B5563",
    marginTop: 8,
  },
  urgentButtonBig: {
    marginTop: 16,
    backgroundColor: "#DC2626",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  urgentButtonBigText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Contacto
  contactBtn: {
    marginTop: 12,
    backgroundColor: "#0EA5E9",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  contactBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Patrocinios / carrusel
  sponsorCard: {
    borderLeftWidth: 3,
    borderLeftColor: "#0EA5E9",
  },
  sponsorHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  sponsorBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0EA5E9",
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  sponsorMiniText: {
    flex: 1,
    fontSize: 11,
    color: "#6B7280",
    textAlign: "right",
    marginLeft: 8,
  },
  sponsorItemCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sponsorName: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  sponsorTagline: {
    marginTop: 2,
    fontSize: 14,
    color: "#4B5563",
  },
  sponsorSmall: {
    marginTop: 6,
    fontSize: 12,
    color: "#6B7280",
  },
  sponsorCta: {
    marginTop: 8,
    fontSize: 12,
    color: "#0EA5E9",
    fontWeight: "500",
  },
  sponsorLinkHint: {
    marginTop: 6,
    fontSize: 11,
    color: "#9CA3AF",
  },
  sponsorDotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
  },
  sponsorDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 3,
  },
  sponsorDotActive: {
    backgroundColor: "#0EA5E9",
  },
  sponsorPayButton: {
    marginTop: 12,
    backgroundColor: "#0EA5E9",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  sponsorPayButtonDisabled: {
    opacity: 0.8,
  },
  sponsorPayButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Pago patrocinio
  paymentMethodRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 8,
    flexWrap: "wrap",
  },
  paymentMethodButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
  },
  paymentMethodButtonActive: {
    backgroundColor: "#0EA5E9",
    borderColor: "#0EA5E9",
  },
  paymentMethodText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "500",
  },
  paymentMethodTextActive: {
    color: "#FFFFFF",
  },
  paymentConfirmButton: {
    marginTop: 16,
    backgroundColor: "#22C55E",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  paymentConfirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  // Settings
  settingsHint: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 4,
  },
  settingsOptionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
    gap: 8,
  },
  settingsOptionButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
  },
  settingsOptionButtonActive: {
    backgroundColor: "#0EA5E9",
    borderColor: "#0EA5E9",
  },
  settingsOptionText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "500",
  },
  settingsOptionTextActive: {
    color: "#FFFFFF",
  },
});
