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
import AppLogo from "../components/AppLogo";
import { API_BASE_URL, AI_ENABLED } from "../config";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const { width } = Dimensions.get("window");

// ---------- AUTENTICACIÓN / CONTEXTO ----------

type AuthContextType = {
  isLogged: boolean;
  userEmail: string | null;

  // Flags base
  isSponsor: boolean;
  isPremium: boolean;

  // Flags "activos" (según backend)
  isSponsorActive: boolean;
  isPremiumActive: boolean;

  sessionTimeoutMinutes: number;
  authToken: string | null;

  login: (
    email: string,
    token: string,
    isSponsorFromApi?: boolean,
    isPremiumFromApi?: boolean,
    isSponsorActiveFromApi?: boolean,
    isPremiumActiveFromApi?: boolean
  ) => Promise<void>;

  logout: () => Promise<void>;

  setSponsor: (value: boolean) => Promise<void>;
  setPremium: (value: boolean) => Promise<void>;

  setSessionTimeoutMinutes: (minutes: number) => Promise<void>;

  // Sync opcional contra backend (muy útil tras pagar)
  refreshBilling: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextType>({
  isLogged: false,
  userEmail: null,

  isSponsor: false,
  isPremium: false,

  isSponsorActive: false,
  isPremiumActive: false,

  sessionTimeoutMinutes: 30,
  authToken: null,

  login: async () => {},
  logout: async () => {},

  setSponsor: async () => {},
  setPremium: async () => {},

  setSessionTimeoutMinutes: async () => {},

  refreshBilling: async () => {},
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
    cta: "Ejemplo de marca que colabora con Calmward.",
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
    cta: "Un patrocinio aquí ayuda a que más personas conozcan tu proyecto.",
    url: "https://www.ejemplo.com/respiraapp",
  },
];

// ---------- FOOTER GLOBAL ----------

function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <View style={styles.footerContainer}>
      <View style={styles.footerLogoRow}>
        <AppLogo size="sm" />
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

function AuthScreen({ navigation, route }: any) {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">(
    route?.params?.startMode === "register" ? "register" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<"hombre" | "mujer" | "otro" | "nd" | "">(
    ""
  );
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    if (!email || !password) {
      setError("Rellena el correo y la contraseña.");
      return;
    }

    if (mode === "register" && !gender) {
      setError("Selecciona tu sexo / género.");
      return;
    }

    if (!API_BASE_URL) {
      setError(
        "La API de Calmward no está configurada. Revisa API_BASE_URL en config.ts."
      );
      return;
    }

    setLoading(true);

    try {
      const endpoint =
        mode === "login" ? "/auth/login" : "/auth/register-and-login";

      const body: any = { email, password };

      if (mode === "register") {
        body.gender = gender;
      }

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let msg =
          "No se ha podido iniciar sesión. Revisa correo y contraseña o vuelve a intentarlo.";
        try {
          const data = await res.json();
          if (data && typeof data.error === "string" && data.error.trim()) {
            msg = data.error.trim();
          }
        } catch {
          // ignoramos JSON inválido
        }
        setError(msg);
        return;
      }

      const data = await res.json();

      const token =
        typeof data.token === "string" && data.token.trim().length > 0
          ? data.token.trim()
          : null;

      const isSponsorFromApi: boolean | undefined =
        typeof data.isSponsor === "boolean" ? data.isSponsor : undefined;

      if (!token) {
        setError(
          "La API no ha devuelto un token de sesión válido. Habla con el desarrollador del backend."
        );
        return;
      }

      await login(
		email,
		token,
		isSponsorFromApi,
		isPremiumFromApi,
		isSponsorActiveFromApi,
		isPremiumActiveFromApi
		);

      if (mode === "register" && gender) {
        try {
          await AsyncStorage.setItem("calmward_gender", gender);
        } catch {
          // no pasa nada si falla
        }
      }

      setError(null);
      setPassword("");

      const parentNav = navigation.getParent?.() || navigation;
      parentNav.reset({
        index: 0,
        routes: [{ name: "Root" }],
      });
    } catch (e) {
      console.log("Error de red con Calmward API", e);
      setError(
        "No se ha podido conectar con el servidor de Calmward. Revisa tu conexión o inténtalo más tarde."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError(
        "Escribe tu correo electrónico para poder enviarte el enlace de recuperación."
      );
      return;
    }

    if (!API_BASE_URL) {
      setError(
        "La API de Calmward no está configurada. Revisa API_BASE_URL en config.ts."
      );
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        let msg =
          "No se ha podido iniciar el proceso de recuperación. Inténtalo de nuevo más tarde.";
        try {
          const data = await res.json();
          if (data && typeof data.error === "string" && data.error.trim()) {
            msg = data.error.trim();
          }
        } catch {}
        Alert.alert("Recuperar contraseña", msg);
        return;
      }

      Alert.alert(
        "Recuperar contraseña",
        "Si ese correo existe en Calmward, recibirás un email con instrucciones para restablecer tu contraseña."
      );
    } catch (e) {
      console.log("Error en recuperar contraseña", e);
      Alert.alert(
        "Recuperar contraseña",
        "No se ha podido conectar con el servidor. Inténtalo más tarde."
      );
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView
        contentContainerStyle={styles.authScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.authHeaderTop}>
          <AppLogo size="lg" />
          <Text style={styles.appMiniTagline}>
            Un lugar discreto para registrar tu día, hablar cuando lo necesites
            y pedir ayuda si algo se complica.
          </Text>
        </View>

        <View style={styles.authCard}>
          <Text style={styles.authWelcome}>Bienvenido a Calmward</Text>
          <Text style={styles.authSubtitle}>
            Inicia sesión o crea tu cuenta para guardar tu día, hablar con la IA
            y acceder a la Comunidad de forma anónima.
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
            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              placeholder="tu_correo@ejemplo.com"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Contraseña</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#9CA3AF"
              />
              <TouchableOpacity
                style={{ marginLeft: 8 }}
                onPress={() => setShowPassword((v) => !v)}
              >
                <Text style={{ fontSize: 12, color: "#0EA5E9" }}>
                  {showPassword ? "Ocultar" : "Mostrar"}
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "login" && (
              <TouchableOpacity
                style={styles.forgotBtn}
                onPress={handleForgotPassword}
              >
                <Text style={styles.forgotText}>
                  Recuperar contraseña por correo
                </Text>
              </TouchableOpacity>
            )}

            {mode === "register" && (
              <>
                <Text style={[styles.label, { marginTop: 12 }]}>
                  ¿Con qué sexo / género te identificas?
                </Text>
                <View style={styles.genderRow}>
                  {[
                    { key: "hombre", label: "Hombre" },
                    { key: "mujer", label: "Mujer" },
                    { key: "otro", label: "Otro" },
                    { key: "nd", label: "Prefiero no decirlo" },
                  ].map((op) => {
                    const active = gender === op.key;
                    return (
                      <TouchableOpacity
                        key={op.key}
                        onPress={() =>
                          setGender(op.key as "hombre" | "mujer" | "otro" | "nd")
                        }
                        style={[
                          styles.genderChip,
                          active && styles.genderChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.genderChipText,
                            active && styles.genderChipTextActive,
                          ]}
                        >
                          {op.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.genderHint}>
                  Este dato solo se usa dentro de Calmward; no se muestra a
                  otras personas.
                </Text>
              </>
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
              Espacio reservado para proyectos que se anuncian en Calmward
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
            Si tienes una app, un proyecto o una marca relacionada con bienestar
            emocional, puedes reservar una tarjeta como la de arriba para
            mostrarla a las personas que usan Calmward.
          </Text>
          <Text style={styles.sectionBody}>
            • El patrocinio te permite enseñar tu proyecto de forma discreta
            dentro de la app.{"\n"}
            • Puedes enlazar a tu web, a tu app o a la tienda donde se descargue
            tu producto.{"\n"}
            • Más adelante podrás ver estadísticas básicas de visualizaciones y
            toques en tu tarjeta.
          </Text>

          {isSponsor ? (
            <Text style={[styles.sectionBody, { marginTop: 8 }]}>
              Tu cuenta ya está marcada como patrocinador activo. Puedes ver tus
              estadísticas desde tu perfil.
            </Text>
          ) : (
            <Text style={[styles.sectionBody, { marginTop: 8 }]}>
              Para configurar un patrocinio necesitas tener una cuenta y haber
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
              {isLogged ? "Ir a página de patrocinio" : "Inicia sesión para patrocinar"}
            </Text>
          </TouchableOpacity>
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- TAB: COMUNIDAD (POSTS ANÓNIMOS) ----------

type CommunityPost = {
  id: string | number;
  text: string;
  likes: number;
  commentsCount?: number;
  createdAt?: string;
};

function CommunityScreen({ navigation }: any) {
  const { isLogged, authToken } = useAuth();

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [newText, setNewText] = useState("");
  const [commentForId, setCommentForId] = useState<string | number | null>(
    null
  );
  const [commentText, setCommentText] = useState("");

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  function normalizePost(raw: any): CommunityPost {
    return {
      id: raw?.id ?? raw?.post_id ?? String(Date.now()),
      text: String(raw?.body || raw?.text || "").trim(),
      likes:
        typeof raw?.likeCount === "number"
          ? raw.likeCount
          : typeof raw?.likes === "number"
          ? raw.likes
          : 0,
      commentsCount:
        typeof raw?.commentCount === "number"
          ? raw.commentCount
          : typeof raw?.commentsCount === "number"
          ? raw.commentsCount
          : typeof raw?.comments_count === "number"
          ? raw.comments_count
          : undefined,
      createdAt: raw?.createdAt || raw?.created_at || undefined,
    };
  }

  async function loadPosts(initial = false) {
    if (!API_BASE_URL) return;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/community/posts`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data?.posts) ? data.posts : data;
      const mapped = Array.isArray(list) ? list.map(normalizePost) : [];
      setPosts(mapped);
    } catch (e) {
      console.log("Error cargando posts comunidad", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadPosts(true);
  }, []);
  function goToAuth(startMode: "login" | "register") {
      const parentNav = navigation.getParent?.() || navigation;
      parentNav.navigate("Auth", { startMode });
    }
  function ensureLoggedForCommunity(actionLabel: string) {
    if (isLogged && authToken) return true;
    Alert.alert(
      "Inicia sesión",
      `Necesitas tener sesión iniciada para ${actionLabel} en la Comunidad.`
    );
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("Auth");
    return false;
  }

  async function handlePublish() {
    const text = newText.trim();
    if (!text) return;
    if (!API_BASE_URL) {
      Alert.alert(
        "Servidor no disponible",
        "La API de Calmward no está configurada (API_BASE_URL)."
      );
      return;
    }

    if (!ensureLoggedForCommunity("publicar")) return;

    await touchActivity();
    setSending(true);

    try {
      const res = await fetch(`${API_BASE_URL}/community/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        let msg =
          "No se ha podido publicar el mensaje. Puede que el texto no cumpla las normas de la comunidad.";
        try {
          const data = await res.json();
          if (data && typeof data.error === "string" && data.error.trim()) {
            msg = data.error.trim();
          }
        } catch {}
        Alert.alert("No se ha publicado", msg);
        return;
      }

      const data = await res.json();
      const created = normalizePost(data?.post ?? data);
      setPosts((prev) => [created, ...prev]);
      setNewText("");
    } catch (e) {
      console.log("Error publicando post comunidad", e);
      Alert.alert(
        "Error de conexión",
        "No se ha podido conectar con el servidor de Calmward."
      );
    } finally {
      setSending(false);
    }
  }

  async function handleLike(postId: string | number) {
    if (!API_BASE_URL) return;
    if (!ensureLoggedForCommunity("dar me gusta")) return;

    await touchActivity();
    try {
      const res = await fetch(
        `${API_BASE_URL}/community/posts/${postId}/like`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );
      if (!res.ok) return;
      const data = await res.json();
      const likeCount =
        typeof data.likeCount === "number"
          ? data.likeCount
          : typeof data.likes === "number"
          ? data.likes
          : 0;

      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, likes: likeCount } : p
        )
      );
    } catch (e) {
      console.log("Error al dar like en comunidad", e);
    }
  }

  function openCommentBox(postId: string | number) {
    if (!ensureLoggedForCommunity("comentar")) return;
    setCommentForId(postId);
    setCommentText("");
  }

  async function handleSendComment() {
    const text = commentText.trim();
    if (!commentForId || !text || !API_BASE_URL) return;

    if (!ensureLoggedForCommunity("comentar")) return;

    await touchActivity();

    try {
      const res = await fetch(
        `${API_BASE_URL}/community/posts/${commentForId}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ text }),
        }
      );

      if (!res.ok) {
        let msg =
          "No se ha podido publicar el comentario. Revisa que respete las normas de la comunidad.";
        try {
          const data = await res.json();
          if (data && typeof data.error === "string" && data.error.trim()) {
            msg = data.error.trim();
          }
        } catch {}
        Alert.alert("Comentario bloqueado", msg);
        return;
      }

      setPosts((prev) =>
        prev.map((p) =>
          p.id === commentForId
            ? {
                ...p,
                commentsCount:
                  typeof p.commentsCount === "number"
                    ? p.commentsCount + 1
                    : 1,
              }
            : p
        )
      );
      setCommentText("");
      setCommentForId(null);
    } catch (e) {
      console.log("Error publicando comentario comunidad", e);
      Alert.alert(
        "Error de conexión",
        "No se ha podido publicar el comentario ahora mismo."
      );
    }
  }

  function formatDate(iso?: string) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return "";
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
                  {!isLogged ? (
            <View style={styles.talkAuthGate}>
              <Text style={styles.talkAuthTitle}>
                Para publicar en la Comunidad necesitas una cuenta
              </Text>
              <Text style={styles.talkAuthSubtitle}>
                Puedes leer lo que comparte la gente, pero para publicar, comentar o dar “me gusta”
                debes iniciar sesión.
              </Text>

              <View style={styles.talkAuthButtonsRow}>
                <TouchableOpacity
                  style={styles.talkAuthBtnOutline}
                  onPress={() => goToAuth("login")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.talkAuthBtnOutlineText}>
                    Iniciar sesión
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.talkAuthBtnPrimary}
                  onPress={() => goToAuth("register")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.talkAuthBtnPrimaryText}>
                    Crear cuenta
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>
                ¿Qué te gustaría compartir hoy?
              </Text>
              <TextInput
                style={styles.dayInput}
                placeholder="Escribe algo que quieras sacar de dentro, desde el respeto hacia ti y hacia los demás..."
                placeholderTextColor="#9CA3AF"
                multiline
                value={newText}
                onChangeText={setNewText}
              />

              <TouchableOpacity
                style={[
                  styles.daySaveBtn,
                  (!newText.trim() || sending) && { opacity: 0.6 },
                ]}
                onPress={handlePublish}
                disabled={!newText.trim() || sending}
              >
                <Text style={styles.daySaveText}>
                  {sending ? "Publicando..." : "Publicar anónimo"}
                </Text>
              </TouchableOpacity>
            </>
          )}


        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Lo último que se ha compartido</Text>
          {loading && (
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator size="small" color="#0EA5E9" />
            </View>
          )}

          {!loading && posts.length === 0 && (
            <Text style={styles.sectionBody}>
              Aún no hay publicaciones. Cuando alguien comparta algo (o tú
              mismo), aparecerá aquí.
            </Text>
          )}

          {posts.map((p) => (
            <View
              key={String(p.id)}
              style={[
                styles.sectionCard,
                {
                  marginTop: 12,
                  marginBottom: 0,
                  backgroundColor: "#F9FAFB",
                },
              ]}
            >
              <Text style={styles.sectionBody}>{p.text}</Text>
              {!!p.createdAt && (
                <Text
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: "#9CA3AF",
                  }}
                >
                  {formatDate(p.createdAt)}
                </Text>
              )}

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 8,
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                                    <TouchableOpacity
                    onPress={() => handleLike(p.id)}
                    disabled={!isLogged}
                    style={{
                      paddingVertical: 4,
                      paddingHorizontal: 8,
                      borderRadius: 999,
                      backgroundColor: isLogged ? "#0EA5E9" : "#CBD5E1",
                      marginRight: 6,
                      opacity: isLogged ? 1 : 0.8,
                    }}
                  >

                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      Me gusta
                    </Text>
                  </TouchableOpacity>
                  <Text
                    style={{ fontSize: 12, color: "#4B5563", minWidth: 40 }}
                  >
                    {p.likes || 0} ❤
                  </Text>
                </View>

                 <TouchableOpacity
                  onPress={() => openCommentBox(p.id)}
                  disabled={!isLogged}
                  style={{
                    paddingVertical: 4,
                    paddingHorizontal: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: isLogged ? "#D1D5DB" : "#E5E7EB",
                    backgroundColor: isLogged ? "transparent" : "#F3F4F6",
                    opacity: isLogged ? 1 : 0.85,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: "#4B5563",
                      fontWeight: "500",
                    }}
                  >
                    Comentar
                    {typeof p.commentsCount === "number" && p.commentsCount > 0
                      ? ` (${p.commentsCount})`
                      : ""}
                  </Text>
                </TouchableOpacity>
              </View>

              {commentForId === p.id && (
                <View style={{ marginTop: 10 }}>
                  <TextInput
                    style={styles.dayInput}
                    placeholder="Escribe tu comentario con respeto..."
                    placeholderTextColor="#9CA3AF"
                    multiline
                    value={commentText}
                    onChangeText={setCommentText}
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      marginTop: 6,
                      gap: 8,
                    } as any}
                  >
                    <TouchableOpacity
                      onPress={() => {
                        setCommentForId(null);
                        setCommentText("");
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#D1D5DB",
                      }}
                    >
                      <Text style={{ fontSize: 12, color: "#4B5563" }}>
                        Cancelar
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSendComment}
                      disabled={!commentText.trim()}
                      style={[
                        {
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: 999,
                          backgroundColor: "#22C55E",
                        },
                        !commentText.trim() && { opacity: 0.6 },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: "#FFFFFF",
                          fontWeight: "600",
                        }}
                      >
                        Enviar comentario
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))}

          {!loading && posts.length > 0 && (
            <TouchableOpacity
              style={{
                marginTop: 16,
                alignSelf: "flex-start",
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "#D1D5DB",
              }}
              onPress={() => loadPosts(false)}
              disabled={refreshing}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: "#4B5563",
                  fontWeight: "500",
                }}
              >
                {refreshing ? "Actualizando..." : "Actualizar lista"}
              </Text>
            </TouchableOpacity>
          )}
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
  const { isLogged, authToken } = useAuth();
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
  function ensureLoggedForAI() {
      if (isLogged && authToken) return true;

      Alert.alert(
        "Inicia sesión",
        "Necesitas iniciar sesión para usar el chat IA de Calmward."
      );

      const parentNav = navigation.getParent?.() || navigation;
      parentNav.navigate("Auth");
      return false;
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
	if (!ensureLoggedForAI()) return;
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const endpoint = "/ai/talk";

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          mode: apiMode,
          message: trimmed,
          history,
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
        console.log("IA devolvió error HTTP", res.status);
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
	function goToAuth(startMode: "login" | "register") {
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("Auth", { startMode });
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

                        {!isLogged ? (
              <View style={styles.talkAuthGate}>
                <Text style={styles.talkAuthTitle}>
                  Para usar el chat necesitas una cuenta
                </Text>
                <Text style={styles.talkAuthSubtitle}>
                  Así mantenemos la Comunidad y el chat más seguros y evitamos abuso.
                </Text>

                <View style={styles.talkAuthButtonsRow}>
                  <TouchableOpacity
                    style={styles.talkAuthBtnOutline}
                    onPress={() => goToAuth("login")}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.talkAuthBtnOutlineText}>
                      Iniciar sesión
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.talkAuthBtnPrimary}
                    onPress={() => goToAuth("register")}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.talkAuthBtnPrimaryText}>
                      Crear cuenta
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
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
                        : "Aquí la IA intentará ayudarte a poner orden: decisiones, problemas que se te hacen bola, siguientes pasos pequeños… (esta parte se desbloquea con Premium en el backend)."}
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
              </>
            )}


          </View>

          <AppFooter />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------- TAB: TU DÍA ----------

function DayScreen({ navigation }: any) {
  const { isLogged } = useAuth();

  const [rating, setRating] = useState<number>(3);
  const [note, setNote] = useState("");

  function goToAuth(startMode: "login" | "register") {
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("Auth", { startMode });
  }

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

          {!isLogged ? (
            <View style={styles.talkAuthGate}>
              <Text style={styles.talkAuthTitle}>
                Para guardar tu día necesitas una cuenta
              </Text>
              <Text style={styles.talkAuthSubtitle}>
                Tu registro diario se vincula a tu sesión para que no pierdas tu historia.
                Inicia sesión o crea una cuenta en dos toques.
              </Text>

              <View style={styles.talkAuthButtonsRow}>
                <TouchableOpacity
                  style={styles.talkAuthBtnOutline}
                  onPress={() => goToAuth("login")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.talkAuthBtnOutlineText}>
                    Iniciar sesión
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.talkAuthBtnPrimary}
                  onPress={() => goToAuth("register")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.talkAuthBtnPrimaryText}>
                    Crear cuenta
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
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
            </>
          )}
        </View>

        <AppFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- PERFIL + PANEL ADMIN ----------

function ProfileScreen({ navigation }: any) {
  const { userEmail, logout, isSponsor, isLogged } = useAuth();
  const [userGender, setUserGender] = useState<string | null>(null);

  const isAdmin = userEmail === "calmward.contact@gmail.com";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const g = await AsyncStorage.getItem("calmward_gender");
        if (active) setUserGender(g);
      } catch {
        // ignoramos
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function genderLabel() {
    if (!userGender) return "No indicado";
    if (userGender === "hombre") return "Hombre";
    if (userGender === "mujer") return "Mujer";
    if (userGender === "otro") return "Otro";
    if (userGender === "nd") return "Prefiero no decirlo";
    return userGender;
  }

  async function handleLogout() {
    await logout();
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.reset({
      index: 0,
      routes: [{ name: "Root" }],
    });
  }

  function goToSponsorStats() {
    if (!isSponsor) return;
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("SponsorStats");
  }

  function goToSettings() {
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("Settings");
  }

  function goToContact() {
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("Contacto");
  }

  function goToLegal() {
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("Legal");
  }

  function goToAdminPanel() {
    const parentNav = navigation.getParent?.() || navigation;
    parentNav.navigate("AdminPanel");
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
                Rol:{" "}
                {isAdmin
                  ? "Administrador de Calmward"
                  : "Usuario estándar de Calmward"}
              </Text>
              <Text style={styles.sectionBody}>
                Sexo / género: {genderLabel()}
              </Text>
              <Text style={styles.sectionBody}>
                Patrocinio: {isSponsor ? "Cuenta patrocinadora" : "Cuenta gratuita"}
              </Text>
              <Text style={styles.sectionBody}>
                Versión de la app: 1.0.0 (preview)
              </Text>
            </>
          ) : (
            <Text style={styles.sectionBody}>
              No hay sesión activa en este momento.
            </Text>
          )}

          {userEmail && (
            <View style={styles.profileButtonsRow}>
              <TouchableOpacity
                style={styles.profileButton}
                onPress={goToSettings}
              >
                <Text style={styles.profileButtonText}>
                  Configuración de la cuenta
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.profileButtonSecondary}
                onPress={goToContact}
              >
                <Text style={styles.profileButtonSecondaryText}>
                  Contacto y soporte
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.profileButtonSecondary}
                onPress={goToLegal}
              >
                <Text style={styles.profileButtonSecondaryText}>
                  Política de privacidad
                </Text>
              </TouchableOpacity>

              {isAdmin && (
                <TouchableOpacity
                  style={[
                    styles.profileButton,
                    { backgroundColor: "#0F766E" },
                  ]}
                  onPress={goToAdminPanel}
                >
                  <Text style={styles.profileButtonText}>
                    Abrir panel de administración
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.profileButton, { backgroundColor: "#DC2626" }]}
                onPress={handleLogout}
              >
                <Text style={styles.profileButtonText}>Cerrar sesión</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {userEmail ? (
  <View style={styles.sectionCard}>
    <Text style={styles.sectionTitle}>Patrocinio</Text>
    {isSponsor ? (
      <>
        <Text style={styles.sectionBody}>
          Tu cuenta está marcada como patrocinador activo de Calmward.
        </Text>
        <Text style={styles.sectionBody}>
          Aquí podrás consultar datos básicos cuando haya un backend conectado.
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
        De momento tu cuenta no tiene un patrocinio activo.
      </Text>
    )}
  </View>
) : null}


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
    Linking.openURL("mailto:calmward.contact@gmail.com")catch(() => {
      Alert.alert(
        "No se pudo abrir el correo",
        "Copia la dirección calmward.contact@gmail.com y escribe desde tu gestor de correo."
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
            <Text style={{ fontWeight: "600" }}>calmward.contact@gmail.com</Text>
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
            Calmward es una aplicación orientada al bienestar emocional y al
            registro personal. No está diseñada para emergencias ni sustituye la
            atención de profesionales de salud mental.
            {"\n\n"}
            Esta política explica qué datos se recogen, para qué se usan y qué
            opciones tienes sobre ellos.
            {"\n\n"}
            1) Responsable y contacto
            {"\n"}
            El responsable del tratamiento de los datos de esta versión de la app
            es el equipo de Calmward. Para dudas sobre privacidad puedes
            contactar en: calmward.contact@gmail.com.
            {"\n\n"}
            2) Datos que podemos tratar
            {"\n"}
            • Datos de cuenta: correo electrónico y credenciales asociadas a tu
            registro/inicio de sesión.
            {"\n"}
            • Datos técnicos básicos: información necesaria para mantener la sesión,
            prevenir abusos y mejorar la estabilidad del servicio.
            {"\n"}
            • Contenido que generas en la app:
            {"\n"}
            - Registro “Tu día” (valoraciones y notas).
            {"\n"}
            - Publicaciones y comentarios en Comunidad.
            {"\n"}
            - Mensajes enviados al chat cuando uses funciones conectadas a backend.
            {"\n\n"}
            3) Finalidades
            {"\n"}
            Usamos estos datos para:
            {"\n"}
            • Crear y mantener tu cuenta.
            {"\n"}
            • Permitir funciones de Comunidad de forma más segura.
            {"\n"}
            • Gestionar el estado de planes (por ejemplo, Sponsor/Premium) cuando
            esta función esté activa en el backend.
            {"\n"}
            • Mejorar la experiencia y prevenir uso indebido.
            {"\n\n"}
            4) Base legal
            {"\n"}
            La base principal es la ejecución del servicio que solicitas al usar
            Calmward y tu consentimiento cuando corresponda. En funciones de
            seguridad y prevención de abuso puede aplicarse el interés legítimo
            de proteger a la comunidad.
            {"\n\n"}
            5) Conservación
            {"\n"}
            Conservaremos los datos mientras mantengas tu cuenta o mientras sean
            necesarios para prestar el servicio. Podremos eliminar o anonimizar
            información cuando deje de ser necesaria.
            {"\n\n"}
            6) Compartición con terceros
            {"\n"}
            Calmward no vende tus datos. Si en el futuro se integran servicios
            externos (por ejemplo pasarelas de pago, correo transaccional o
            herramientas de analítica), se informará de forma clara sobre qué
            datos se comparten y con qué propósito.
            {"\n\n"}
            7) Cookies y tecnologías similares
            {"\n"}
            La app móvil de Calmward no utiliza cookies del navegador.
            {"\n"}
            Sin embargo, puede usar almacenamiento local del dispositivo
            (por ejemplo AsyncStorage) para guardar tu sesión, preferencias y
            estados de la app.
            {"\n"}
            Si en el futuro existe una versión web pública de Calmward, esa web
            podría usar cookies técnicas necesarias para funcionar y, en su caso,
            se mostrará un aviso específico de cookies.
            {"\n\n"}
            8) Tus derechos
            {"\n"}
            Puedes solicitar acceso, rectificación o eliminación de tus datos, así
            como otras opciones aplicables según la normativa vigente (por ejemplo
            RGPD). Para ejercerlos, escribe a calmward.contact@gmail.com.
            {"\n\n"}
            9) Recomendación legal
            {"\n"}
            Antes de publicar la app en tiendas oficiales, te recomendamos revisar
            esta política con asesoría legal para ajustarla a tu país y al alcance
            final del producto.
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

// ---------- PAGO DE PATROCINIO (SIMULACIÓN) ----------

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
        "Patrocinio activado (simulación)",
        "Tu cuenta se ha marcado como patrocinador de Calmward. En producción, aquí se conectará el pago real por PayPal."
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
            etc.) en el backend.
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
            En producción, aquí se abrirá el checkout de PayPal con pago por
            tarjeta o cuenta PayPal, y el dinero llegará a tu cuenta PayPal.
          </Text>

          <TouchableOpacity
            style={styles.paymentConfirmButton}
            onPress={handleConfirm}
            disabled={processing}
          >
            <Text style={styles.paymentConfirmButtonText}>
              {processing ? "Procesando..." : "Confirmar patrocinio (demo)"}
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
  const [showPhones, setShowPhones] = useState(false);

  async function touchActivity() {
    try {
      await AsyncStorage.setItem(
        "calmward_last_activity",
        String(Date.now())
      );
    } catch {}
  }

  const HELP_LINES = [
    {
      label: "Emergencias (Europa)",
      number: "112",
      note: "Peligro inmediato",
    },
    {
      label: "Línea 024 (España)",
      number: "024",
      note: "Atención a la conducta suicida",
    },
    {
      label: "Teléfono de la Esperanza",
      number: "717 003 717",
      note: "Apoyo emocional",
    },
    {
      label: "ANAR Niños y Adolescentes",
      number: "900 20 20 10 / 116 111",
      note: "Ayuda 24h",
    },
    {
      label: "ANAR Familia y Centros Escolares",
      number: "600 50 51 52",
      note: "Orientación a adultos",
    },
    {
      label: "ANAR Niños Desaparecidos",
      number: "116 000",
      note: "Línea europea",
    },
    {
      label: "Acoso escolar",
      number: "900 018 018",
      note: "Servicio gestionado con ANAR",
    },
  ];

  function handleHelpPhones() {
    touchActivity();
    setShowPhones(true);
  }

  function callNumber(num: string) {
    const first = num.split("/")[0].trim();
    const clean = first.replace(/\s+/g, "");
    Linking.openURL(`tel:${clean}`).catch(() => {
      Alert.alert(
        "No se pudo iniciar la llamada",
        `Marca manualmente ${first}.`
      );
    });
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
            • Usar líneas de ayuda emocional disponibles en tu zona.
          </Text>

          <TouchableOpacity
            style={styles.urgentButtonBig}
            onPress={handleHelpPhones}
          >
            <Text style={styles.urgentButtonBigText}>
              Buscar teléfonos de ayuda
            </Text>
          </TouchableOpacity>

          {showPhones && (
            <View style={styles.urgentPhonesCard}>
              <Text style={styles.urgentPhonesTitle}>
                Teléfonos de ayuda en España
              </Text>

              {HELP_LINES.map((l) => (
                <View key={l.label} style={styles.urgentPhoneRow}>
                  <View style={styles.urgentPhoneLeft}>
                    <Text style={styles.urgentPhoneLabel}>{l.label}</Text>
                    <Text style={styles.urgentPhoneNumber}>{l.number}</Text>
                    <Text style={styles.urgentPhoneNote}>{l.note}</Text>
                  </View>

                  <TouchableOpacity
                    style={styles.urgentPhoneCall}
                    onPress={() => callNumber(l.number)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.urgentPhoneCallText}>Llamar</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <Text style={styles.urgentPhonesHint}>
                Si no estás en España, estos números pueden variar.
              </Text>
            </View>
          )}

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

// ---------- PANEL ADMIN (APP) ----------

type AdminUser = {
  id: number;
  email: string;
  is_banned?: boolean;
  community_banned?: boolean;
  is_admin?: boolean;
  is_sponsor?: boolean;
  created_at?: string;
};

type AdminPost = {
  id: number;
  body: string;
  created_at?: string;
  flagged_toxic?: boolean;
  user_id?: number;
  email?: string;
};

function AdminPanelScreen({ navigation }: any) {
  const { authToken, userEmail } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = userEmail === "calmward.contact@gmail.com";

  useEffect(() => {
    if (!isAdmin || !authToken) {
      setLoading(false);
      return;
    }
    loadAll();
  }, [isAdmin, authToken]);

  async function loadAll() {
    if (!API_BASE_URL || !authToken) return;
    try {
      setLoading(true);
      const [uRes, pRes] = await Promise.all([
        fetch(`${API_BASE_URL}/admin/users`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }),
        fetch(`${API_BASE_URL}/admin/posts`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }),
      ]);

      if (uRes.ok) {
        const data = await uRes.json();
        setUsers(Array.isArray(data?.users) ? data.users : []);
      }
      if (pRes.ok) {
        const data = await pRes.json();
        setPosts(Array.isArray(data?.posts) ? data.posts : []);
      }
    } catch (e) {
      console.log("Error cargando datos admin", e);
      Alert.alert(
        "Error",
        "No se han podido cargar los datos del panel de administración."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleToggleBan(u: AdminUser) {
    if (!API_BASE_URL || !authToken) return;
    const current = !!u.community_banned;
    const endpoint = current ? "unban" : "ban";
    try {
      const res = await fetch(`${API_BASE_URL}/admin/${endpoint}/${u.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!res.ok) {
        Alert.alert(
          "Error",
          "No se ha podido actualizar el estado de la cuenta."
        );
        return;
      }
      setUsers((prev) =>
        prev.map((usr) =>
          usr.id === u.id ? { ...usr, community_banned: !current } : usr
        )
      );
    } catch (e) {
      console.log("Error al cambiar ban comunidad", e);
    }
  }

  async function handleDeletePost(p: AdminPost) {
    if (!API_BASE_URL || !authToken) return;
    Alert.alert(
      "Eliminar post",
      "¿Seguro que quieres borrar este post de la comunidad?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(
                `${API_BASE_URL}/admin/posts/${p.id}`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                  },
                }
              );
              if (!res.ok) {
                Alert.alert(
                  "Error",
                  "No se ha podido borrar el post."
                );
                return;
              }
              setPosts((prev) => prev.filter((x) => x.id !== p.id));
            } catch (e) {
              console.log("Error borrando post en admin", e);
            }
          },
        },
      ]
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadAll();
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.screen}>
        <AppHeader navigation={navigation} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Panel de administración</Text>
            <Text style={styles.sectionBody}>
              Esta sección solo está disponible para la cuenta administradora de
              Calmward.
            </Text>
          </View>
          <AppFooter />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AppHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Panel de administración</Text>
          <Text style={styles.sectionBody}>
            Gestiona usuarios y publicaciones de la Comunidad.
          </Text>

          {loading && (
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator size="small" color="#0EA5E9" />
            </View>
          )}

          {!loading && (
            <>
              <View
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 12,
                  backgroundColor: "#EFF6FF",
                }}
              >
                <Text style={{ fontSize: 13, color: "#1D4ED8" }}>
                  Usuarios totales: {users.length}
                </Text>
                <Text style={{ fontSize: 13, color: "#1D4ED8" }}>
                  Posts en comunidad: {posts.length}
                </Text>
              </View>

              <TouchableOpacity
                onPress={handleRefresh}
                disabled={refreshing}
                style={{
                  marginTop: 10,
                  alignSelf: "flex-start",
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#D1D5DB",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: "#4B5563",
                    fontWeight: "500",
                  }}
                >
                  {refreshing ? "Actualizando..." : "Actualizar datos"}
                </Text>
              </TouchableOpacity>

              <Text
                style={[
                  styles.sectionSubtitle,
                  { marginTop: 16, fontWeight: "600" },
                ]}
              >
                Usuarios
              </Text>

              {users.map((u) => (
                <View
                  key={u.id}
                  style={{
                    marginTop: 8,
                    padding: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#E5E7EB",
                    backgroundColor: "#FFFFFF",
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600" }}>
                    {u.email}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>
                    ID: {u.id} · Patrocinador: {u.is_sponsor ? "Sí" : "No"}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>
                    Baneado comunidad: {u.community_banned ? "Sí" : "No"}
                  </Text>

                  <TouchableOpacity
                    onPress={() => handleToggleBan(u)}
                    style={{
                      marginTop: 6,
                      alignSelf: "flex-start",
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: u.community_banned
                        ? "#22C55E"
                        : "#DC2626",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#FFFFFF",
                        fontWeight: "600",
                      }}
                    >
                      {u.community_banned
                        ? "Desbloquear comunidad"
                        : "Bloquear comunidad"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}

              <Text
                style={[
                  styles.sectionSubtitle,
                  { marginTop: 16, fontWeight: "600" },
                ]}
              >
                Posts recientes
              </Text>

              {posts.map((p) => (
                <View
                  key={p.id}
                  style={{
                    marginTop: 8,
                    padding: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#E5E7EB",
                    backgroundColor: "#F9FAFB",
                  }}
                >
                  <Text style={{ fontSize: 13, color: "#111827" }}>
                    {p.body}
                  </Text>
                  {p.email && (
                    <Text
                      style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}
                    >
                      Autor: {p.email || "Anónimo"}
                    </Text>
                  )}
                  {p.created_at && (
                    <Text
                      style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}
                    >
                      {new Date(p.created_at).toLocaleString()}
                    </Text>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      marginTop: 6,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => handleDeletePost(p)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 999,
                        backgroundColor: "#DC2626",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: "#FFFFFF",
                          fontWeight: "600",
                        }}
                      >
                        Borrar post
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}
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
          if (route.name === "Comunidad") icon = "account-group-outline";
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
      <Tab.Screen name="Comunidad" component={CommunityScreen} />
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
  const [isSponsor, setIsSponsorState] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutesState] = useState(30);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isPremium, setIsPremiumState] = useState(false);
  const [isSponsorActive, setIsSponsorActiveState] = useState(false);
  const [isPremiumActive, setIsPremiumActiveState] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const token = await AsyncStorage.getItem("calmward_token");
        const email = await AsyncStorage.getItem("calmward_email");
        const sponsorFlag = await AsyncStorage.getItem("calmward_is_sponsor");
		const premiumFlag = await AsyncStorage.getItem("calmward_is_premium");
		const sponsorActiveFlag = await AsyncStorage.getItem("calmward_is_sponsor_active");
		const premiumActiveFlag = await AsyncStorage.getItem("calmward_is_premium_active");
        const timeoutStr = await AsyncStorage.getItem(
          "calmward_session_timeout_minutes"
        );

        setIsLogged(!!token);
        setUserEmail(email);
        setIsSponsorState(sponsorFlag === "1");
		setIsPremiumState(premiumFlag === "1");
		setIsSponsorActiveState(sponsorActiveFlag === "1");
		setIsPremiumActiveState(premiumActiveFlag === "1");
        setAuthToken(token);

        if (timeoutStr) {
          const parsed = parseInt(timeoutStr, 10);
          if (!isNaN(parsed) && parsed >= 0) {
            setSessionTimeoutMinutesState(parsed);
          }
        }
      } catch (e) {
        setIsLogged(false);
        setUserEmail(null);
        setIsSponsorState(false);
        setSessionTimeoutMinutesState(30);
        setAuthToken(null);
      } finally {
        setReady(true);
      }
    }
    load();
  }, []);
  
	useEffect(() => {
	if (authToken) {
		refreshBilling();
	}
	}, [authToken]);
	
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
          setIsLogged(false);
          setUserEmail(null);
          setIsSponsorState(false);
          setAuthToken(null);
        }
      } catch {
        // ignoramos
      }
    }, 60000);

    return () => clearInterval(id);
  }, [isLogged, sessionTimeoutMinutes]);

async function refreshBilling() {
  try {
    if (!API_BASE_URL || !authToken) return;

    const res = await fetch(`${API_BASE_URL}/billing/subscription`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return;

    const data = await res.json();

    const s = !!data?.isSponsor;
    const p = !!data?.isPremium;
    const sA = !!data?.isSponsorActive;
    const pA = !!data?.isPremiumActive;

    await AsyncStorage.setItem("calmward_is_sponsor", s ? "1" : "0");
    await AsyncStorage.setItem("calmward_is_premium", p ? "1" : "0");
    await AsyncStorage.setItem("calmward_is_sponsor_active", sA ? "1" : "0");
    await AsyncStorage.setItem("calmward_is_premium_active", pA ? "1" : "0");

    setIsSponsorState(s);
    setIsPremiumState(p);
    setIsSponsorActiveState(sA);
    setIsPremiumActiveState(pA);
  } catch {
    // silencioso
  }
}

  const authContext = useMemo<AuthContextType>(
    () => ({
		isLogged,
		userEmail,

		isSponsor,
		isPremium,

		isSponsorActive,
		isPremiumActive,

		sessionTimeoutMinutes,
		authToken,
		
      login: async (
		email: string,
		token: string,
		sponsorFlag?: boolean,
		premiumFlag?: boolean,
		sponsorActiveFlag?: boolean,
		premiumActiveFlag?: boolean
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
		if (typeof premiumFlag === "boolean") {
		await AsyncStorage.setItem(
			"calmward_is_premium",
			premiumFlag ? "1" : "0"
		);
		setIsPremiumState(premiumFlag);
		}

		if (typeof sponsorActiveFlag === "boolean") {
		await AsyncStorage.setItem(
			"calmward_is_sponsor_active",
			sponsorActiveFlag ? "1" : "0"
		);
		setIsSponsorActiveState(sponsorActiveFlag);
		}

		if (typeof premiumActiveFlag === "boolean") {
		await AsyncStorage.setItem(
			"calmward_is_premium_active",
			premiumActiveFlag ? "1" : "0"
		);
		setIsPremiumActiveState(premiumActiveFlag);
		}

        setIsLogged(true);
        setUserEmail(email);
        setAuthToken(token);
		await refreshBilling();
      },
      logout: async () => {
        await AsyncStorage.removeItem("calmward_token");
        await AsyncStorage.removeItem("calmward_email");
        await AsyncStorage.removeItem("calmward_is_sponsor");
		await AsyncStorage.removeItem("calmward_is_premium");
		await AsyncStorage.removeItem("calmward_is_sponsor_active");
		await AsyncStorage.removeItem("calmward_is_premium_active");
        await AsyncStorage.removeItem("calmward_last_activity");
        setIsLogged(false);
        setUserEmail(null);
        setIsSponsorState(false);
		setIsPremiumState(false);
		setIsSponsorActiveState(false);
		setIsPremiumActiveState(false);
        setAuthToken(null);
      },

      setSponsor: async (value: boolean) => {
        await AsyncStorage.setItem("calmward_is_sponsor", value ? "1" : "0");
        setIsSponsorState(value);
      },
	  setPremium: async (value: boolean) => {
	  await AsyncStorage.setItem("calmward_is_premium", value ? "1" : "0");
	  setIsPremiumState(value);
	  },
      setSessionTimeoutMinutes: async (minutes: number) => {
        const safe = minutes < 0 ? 0 : minutes;
        await AsyncStorage.setItem(
          "calmward_session_timeout_minutes",
          String(safe)
        );
        setSessionTimeoutMinutesState(safe);
      },
	  refreshBilling: async () => {
	  await refreshBilling();
	  },
    }),
  [
    isLogged,
    userEmail,
    isSponsor,
    isPremium,
    isSponsorActive,
    isPremiumActive,
    sessionTimeoutMinutes,
    authToken
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
        <Stack.Screen name="Root" component={AppTabs} />
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="Contacto" component={ContactScreen} />
        <Stack.Screen name="Legal" component={LegalScreen} />
        <Stack.Screen name="SponsorStats" component={SponsorStatsScreen} />
        <Stack.Screen name="SponsorPayment" component={SponsorPaymentScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
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
  authScroll: {
    padding: 16,
    paddingBottom: 32,
  },
  authHeaderTop: {
    alignItems: "center",
    marginBottom: 16,
  },
  appMiniTagline: {
    marginTop: 8,
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
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
  forgotBtn: {
    marginTop: 8,
    alignSelf: "flex-end",
  },
  forgotText: {
    fontSize: 12,
    color: "#0EA5E9",
  },
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
  summaryRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 12,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#6B7280",
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  genderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  genderChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
  },
  genderChipActive: {
    backgroundColor: "#0EA5E9",
    borderColor: "#0EA5E9",
  },
  genderChipText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "500",
  },
  genderChipTextActive: {
    color: "#FFFFFF",
  },
  genderHint: {
    marginTop: 4,
    fontSize: 11,
    color: "#9CA3AF",
  },
  profileButtonsRow: {
    marginTop: 12,
  },
  profileButton: {
    marginTop: 8,
    backgroundColor: "#0EA5E9",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  profileButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  profileButtonSecondary: {
    marginTop: 8,
    backgroundColor: "#E5E7EB",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  profileButtonSecondaryText: {
    color: "#111827",
    fontWeight: "500",
  },
    talkAuthGate: {
    marginTop: 14,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  talkAuthTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  talkAuthSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: "#6B7280",
  },
  talkAuthButtonsRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  talkAuthBtnOutline: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#0EA5E9",
    backgroundColor: "#FFFFFF",
  },
  talkAuthBtnOutlineText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0EA5E9",
  },
  talkAuthBtnPrimary: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#0EA5E9",
  },
  talkAuthBtnPrimaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
    urgentPhonesCard: {
    marginTop: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  urgentPhonesTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  urgentPhoneRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
  },
  urgentPhoneLeft: {
    flex: 1,
    paddingRight: 10,
  },
  urgentPhoneLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  urgentPhoneNumber: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "700",
    color: "#0EA5E9",
  },
  urgentPhoneNote: {
    marginTop: 2,
    fontSize: 11,
    color: "#6B7280",
  },
  urgentPhoneCall: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#0EA5E9",
  },
  urgentPhoneCallText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  urgentPhonesHint: {
    marginTop: 8,
    fontSize: 10,
    color: "#9CA3AF",
  },
});
