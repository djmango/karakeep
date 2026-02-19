import { useLayoutEffect } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import UpdatingBookmarkList from "@/components/bookmarks/UpdatingBookmarkList";
import CustomSafeAreaView from "@/components/ui/CustomSafeAreaView";

export default function Favourites() {
  const navigator = useNavigation();
  useLayoutEffect(() => {
    navigator.setOptions({
      headerTitle: "⭐️ Favourites",
      ...Platform.select({
        ios: { headerLargeTitle: true },
      }),
    });
  }, [navigator]);
  return (
    <CustomSafeAreaView>
      <UpdatingBookmarkList
        query={{
          favourited: true,
        }}
      />
    </CustomSafeAreaView>
  );
}
