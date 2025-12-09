// src/components/AppHeader.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AppLogo from "./AppLogo";

type Props = {
  navigation: any;
};

const AppHeader: React.FC<Props> = ({ navigation }) => {
  const [isLogged, setIsLogged] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mainMenuOpen, setMainMenuOpen] = useState(false);

  async function loadSession() {
    try {
      const token = await AsyncStorage.getItem("calmward_token");
      setIsLogged(!!token);
    } catch {
      setIsLogged(false);
    }
  }

  useEffect(() => {
    loadSession();
    const unsubscribe =
      navigation?.addListener?.("focus", () => {
        loadSession();
      }) || undefined;

    return unsubscribe;
  }, [navigation]);

  function closeAllMenus() {
    setUserMenuOpen(false);
    setMainMenuOpen(false);
  }

  // --- helpers de navegación seguros (sin romper con Root/Auth) ---

  function navigateToPerfil() {
    closeAllMenus();
    const state = navigation.getState?.();
    // Si este navigator conoce Root, usamos Root + tab Perfil
    if (state && Array.isArray(state.routeNames)) {
      if (state.routeNames.includes("Root")) {
        navigation.navigate("Root" as never, {
          screen: "Perfil",
        } as never);
        return;
      }
      if (state.routeNames.includes("Perfil")) {
        navigation.navigate("Perfil" as never);
        return;
      }
    }
    navigation.navigate("Perfil" as never);
  }

  function navigateToSettings() {
    closeAllMenus();
    const target = "Settings";
    const state = navigation.getState?.();

    if (state && Array.isArray(state.routeNames) && state.routeNames.includes(target)) {
      navigation.navigate(target as never);
      return;
    }

    const parent = navigation.getParent?.();
    if (parent) {
      const pState = parent.getState?.();
      if (
        pState &&
        Array.isArray(pState.routeNames) &&
        pState.routeNames.includes(target)
      ) {
        parent.navigate(target as never);
        return;
      }
    }

    navigation.navigate(target as never);
  }

  function navigateStackScreen(target: "Contacto" | "Legal") {
    closeAllMenus();
    const state = navigation.getState?.();

    // Si estamos en el Stack principal y conoce la ruta, navegamos directo
    if (state && Array.isArray(state.routeNames) && state.routeNames.includes(target)) {
      navigation.navigate(target as never);
      return;
    }

    // Si estamos en Tabs, subimos al padre (Stack) y navegamos desde ahí
    const parent = navigation.getParent?.();
    if (parent) {
      const pState = parent.getState?.();
      if (
        pState &&
        Array.isArray(pState.routeNames) &&
        pState.routeNames.includes(target)
      ) {
        parent.navigate(target as never);
        return;
      }
    }

    // Fallback
    navigation.navigate(target as never);
  }

  function handleAvatarPress() {
    setUserMenuOpen((prev) => !prev);
    setMainMenuOpen(false);
  }

  function handleBurgerPress() {
    setMainMenuOpen((prev) => !prev);
    setUserMenuOpen(false);
  }

  function handleLogout() {
    // Cerrar sesión se hace de verdad en la pantalla Perfil (botón Cerrar sesión)
    // Aquí te llevo allí directamente para que la cierres desde el sitio correcto.
    navigateToPerfil();
  }

  function handleLogin() {
    closeAllMenus();
    const state = navigation.getState?.();
    if (state && Array.isArray(state.routeNames) && state.routeNames.includes("Auth")) {
      navigation.navigate("Auth" as never);
      return;
    }
    const parent = navigation.getParent?.();
    if (parent) {
      const pState = parent.getState?.();
      if (
        pState &&
        Array.isArray(pState.routeNames) &&
        pState.routeNames.includes("Auth")
      ) {
        parent.navigate("Auth" as never);
        return;
      }
    }
    navigation.navigate("Auth" as never);
  }

  function handleRegister() {
    handleLogin(); // misma pantalla Auth con pestaña de registro
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {/* Logo + nombre app (sin tagline) */}
        <View style={styles.brandRow}>
		<AppLogo size="sm" showText />
		</View>

        {/* Acciones derecha: menú hamburguesa + login/avatar */}
        <View style={styles.actions}>
          {/* Menú hamburguesa */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleBurgerPress}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="menu"
              size={24}
              color="#111827"
            />
          </TouchableOpacity>

          {!isLogged ? (
            <>
              <TouchableOpacity
                style={[styles.chip, styles.chipOutline]}
                onPress={handleLogin}
              >
                <Text style={styles.chipOutlineText}>Iniciar sesión</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, styles.chipPrimary]}
                onPress={handleRegister}
              >
                <Text style={styles.chipPrimaryText}>Crear cuenta</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.avatarButton}
              onPress={handleAvatarPress}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="account-circle"
                size={28}
                color="#111827"
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* MENÚ DESPLEGABLE HAMBURGUESA (Contacto / Legal) */}
      {mainMenuOpen && (
        <View style={styles.mainMenu}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigateStackScreen("Contacto")}
          >
            <MaterialCommunityIcons
              name="email-outline"
              size={18}
              color="#111827"
            />
            <Text style={styles.menuItemText}>Contacto</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigateStackScreen("Legal")}
          >
            <MaterialCommunityIcons
              name="shield-lock-outline"
              size={18}
              color="#111827"
            />
            <Text style={styles.menuItemText}>Política de privacidad</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* MENÚ DESPLEGABLE USUARIO (Perfil / Configuración / Cerrar sesión) */}
      {isLogged && userMenuOpen && (
        <View style={styles.userMenu}>
          <TouchableOpacity style={styles.menuItem} onPress={navigateToPerfil}>
            <MaterialCommunityIcons
              name="account-circle-outline"
              size={18}
              color="#111827"
            />
            <Text style={styles.menuItemText}>Perfil</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={navigateToSettings}>
            <MaterialCommunityIcons
              name="cog-outline"
              size={18}
              color="#374151"
            />
            <Text style={styles.menuItemText}>Configuración de la cuenta</Text>
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={18} color="#DC2626" />
            <Text style={[styles.menuItemText, { color: "#DC2626" }]}>
              Cerrar sesión
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: "#F3F4F6",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    position: "relative",
    zIndex: 30,
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: width * 0.6,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    padding: 6,
    marginRight: 4,
    borderRadius: 999,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 4,
  },
  chipOutline: {
    borderWidth: 1,
    borderColor: "#9CA3AF",
    backgroundColor: "transparent",
  },
  chipOutlineText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "500",
  },
  chipPrimary: {
    backgroundColor: "#0EA5E9",
  },
  chipPrimaryText: {
    fontSize: 12,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  avatarButton: {
    borderRadius: 999,
    padding: 2,
    marginLeft: 6,
    zIndex: 40,
  },
  // menú hamburguesa
  mainMenu: {
    position: "absolute",
    top: 56, // debajo del header
    right: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
    minWidth: 200,
    zIndex: 20,
  },
  // menú usuario
  userMenu: {
    position: "absolute",
    top: 56,
    right: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
    minWidth: 220,
    zIndex: 25,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  menuItemText: {
    marginLeft: 8,
    fontSize: 13,
    color: "#111827",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
});

export default AppHeader;
