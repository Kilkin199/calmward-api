import React from "react";
import { View, Text, StyleSheet } from "react-native";

type Props = {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
};

export default function AppLogo({ size = "md", showText = true }: Props) {
  const dim = size === "sm" ? 36 : size === "lg" ? 80 : 52;

  return (
    <View style={styles.row}>
      <View style={[styles.icon, { width: dim, height: dim, borderRadius: dim / 2 }]}>
        <Text style={styles.c}>C</Text>
      </View>
      {showText && <Text style={styles.txt}>Calmward</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    backgroundColor: "#38bdf8",
    alignItems: "center",
    justifyContent: "center",
  },
  c: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 26,
  },
  txt: {
    color: "#0f172a",
    marginLeft: 8,
    fontWeight: "800",
    fontSize: 19,
  },
});