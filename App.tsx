// App.tsx
import React from "react";
import { StatusBar } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import MainNavigation from "./src/navigation/MainNavigation";

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#ffffff", // o el fondo claro que estés usando en Calmward
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <StatusBar barStyle="dark-content" />
        <MainNavigation />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
