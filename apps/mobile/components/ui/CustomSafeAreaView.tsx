import { SafeAreaView } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";

export default function CustomSafeAreaView({
  children,
  edges = ["top", "bottom"],
}: {
  children: React.ReactNode;
  edges?: ("top" | "bottom")[];
}) {
  const headerHeight = useHeaderHeight();

  return (
    <SafeAreaView
      style={{
        flex: 1,
        paddingTop: edges.includes("top")
          ? headerHeight > 0
            ? headerHeight
            : undefined
          : undefined,
      }}
    >
      {children}
    </SafeAreaView>
  );
}
