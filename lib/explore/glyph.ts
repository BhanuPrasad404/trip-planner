import type { PlaceCategory } from "@/lib/categories";
import type { ExploreCategoryId } from "./categories";

/** Explore's categories are finer than TrailMate's planner categories; this is the planner category (icon, default visit time) each one uses. */
export const plannerCategory = (id: ExploreCategoryId): PlaceCategory => (id === "heritage" ? "temple" : id === "peak" ? "hill_station" : id);
