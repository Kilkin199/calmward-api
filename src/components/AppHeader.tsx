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

  // --- helpers de navegación con las tabs como raíz ---

  function navigateToPerfil() {
    closeAllMenus();
    navigation.navigate("Perfil");
  }

  function navigateToSettings() {
    closeAllMenus();
    navigation.navigate("Settings");
  }

  function navigateStackScreen(target: "Contacto" | "Sugerencias" | "Legal") {
    closeAllMenus();
    navigation.navigate(target);
  }

  function handleAvatarPress() {
    setUserMenuOpen((prev) => !prev);
    setMainMenuOpen(false);
  }

  function handleBurgerPress() {
    setMainMenuOpen((prev) => !prev);
    setUserMenuOpen(false);
  }

  // siempre forzamos startMode = "login" o "register"
  function handleLogin() {
    closeAllMenus();
    navigation.navigate("Auth", { startMode: "login" as "login" | "register" });
  }

  function handleRegister() {
    closeAllMenus();
    navigation.navigate("Auth", {
      startMode: "register" as "login" | "register",
    });
  }

  function handleLogout() {
    // El cierre de sesión real se hace en la pantalla Perfil
    navigateToPerfil();
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {/* Logo + nombre app */}
        <View style={styles.brandRow}>
          <AppLogo size="sm" showText />
        </View>

        {/* Acciones derecha */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleBurgerPress}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="menu" size={24} color="#111827" />
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

      {/* MENÚ DESPLEGABLE HAMBURGUESA */}
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
            onPress={() => navigateStackScreen("Sugerencias")}
          >
            <MaterialCommunityIcons
              name="lightbulb-on-outline"
              size={18}
              color="#111827"
            />
            <Text style={styles.menuItemText}>Sugerencias</Text>
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

      {/* MENÚ USUARIO */}
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
            <Text style={styles.menuItemText}>
              Configuración de la cuenta
            </Text>
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
    flexShrink: 0,
    minWidth: 0,
    maxWidth: width * 0.4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    padding: 6,
    marginRight: 0,
    borderRadius: 999,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    marginLeft: 1,
  },
  chipOutline: {
    borderWidth: 1,
    borderColor: "#9CA3AF",
    backgroundColor: "transparent",
  },
  chipOutlineText: {
    fontSize: 11,
    color: "#4B5563",
    fontWeight: "500",
  },
  chipPrimary: {
    backgroundColor: "#0EA5E9",
  },
  chipPrimaryText: {
    fontSize: 11,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  avatarButton: {
    borderRadius: 999,
    padding: 2,
    marginLeft: 6,
    zIndex: 40,
  },
  mainMenu: {
    position: "absolute",
    top: 56,
    right: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    // antes tenías shadowColor / shadowOpacity / shadowRadius / shadowOffset / elevation
    // los quitamos para que RN Web no avise
    borderWidth: 1,
    borderColor: "#E5E7EB",
    minWidth: 200,
    zIndex: 20,
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
