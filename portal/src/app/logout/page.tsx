"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
// import { useAppDispatch } from "@/lib/hooks";
import { useAppDispatch } from "@/store/hooks";
// import { clearUser } from "@/store/userSlice";
import { logoutUserFully } from "@/store/features/user/userSlice";

export default function LogoutPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Clear user from Redux
    dispatch(logoutUserFully());
    console.log("---> Logged out user");

    // Redirect to home
    router.push("/");
  }, [dispatch, router]);

  return null;
}
