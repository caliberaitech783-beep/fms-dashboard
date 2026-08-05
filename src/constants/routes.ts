import {
  AlertTriangle,
  BarChart3,
  Bell,
  BellDot,
  ClipboardList,
  Database,
  Fuel,
  Gauge,
  Megaphone,
  MessageCircle,
  Settings,
  Truck,
  UserCog,
} from "lucide-react";

export const NAV_GROUPS = [
  { id: "operate", label: "Operate" },
  { id: "analyze", label: "Analyze" },
  { id: "control", label: "Control" },
  { id: "admin", label: "Admin" },
] as const;

export type NavGroupId = (typeof NAV_GROUPS)[number]["id"];

export const NAV_ITEMS = [
  { id: "management", label: "Management Dashboard", icon: BarChart3 },
  { id: "fleet", label: "Fleet", icon: Truck },
  { id: "fuel", label: "Fuel", icon: Fuel },
  { id: "production", label: "Production", icon: Gauge },
  { id: "alerts", label: "Alerts", icon: AlertTriangle },
  { id: "reports", label: "Reports", icon: ClipboardList },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "admin-notifications", label: "Admin Notifications", icon: Megaphone },
  { id: "integrations", label: "Integrations", icon: Database },
  { id: "whatsapp", label: "WhatsApp Delivery", icon: MessageCircle },
  { id: "master-data", label: "Master Data", icon: BellDot },
  { id: "users", label: "Users", icon: UserCog },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavItemId = (typeof NAV_ITEMS)[number]["id"];
