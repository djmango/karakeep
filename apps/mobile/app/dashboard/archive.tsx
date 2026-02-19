import { useLayoutEffect } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import UpdatingBookmarkList from "@/components/bookmarks/UpdatingBookmarkList";
import CustomSafeAreaView from "@/components/ui/CustomSafeAreaView";

export default function Archive() {
  const navigator = useNavigation();
  useLayoutEffect(() => {
    navigator.setOptions({
      headerTitle: "🗄️ Archive",
      ...Platform.select({
        ios: { headerLargeTitle: true },
      }),
    });
  }, [navigator]);
  return (
    <CustomSafeAreaView>
      <UpdatingBookmarkList query={{ archived: true }} />
    </CustomSafeAreaView>
  );
}
