import { z } from "zod";
export declare const idSchema: z.ZodString;
export declare const instantSchema: z.ZodString;
export declare const currencySchema: z.ZodLiteral<"INR">;
export declare const moneySchema: z.ZodObject<{
    amountMinor: z.ZodNumber;
    currency: z.ZodLiteral<"INR">;
}, "strip", z.ZodTypeAny, {
    amountMinor: number;
    currency: "INR";
}, {
    amountMinor: number;
    currency: "INR";
}>;
export declare const windowSchema: z.ZodEffects<z.ZodObject<{
    start: z.ZodString;
    end: z.ZodString;
    timezone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    start: string;
    end: string;
    timezone: string;
}, {
    start: string;
    end: string;
    timezone: string;
}>, {
    start: string;
    end: string;
    timezone: string;
}, {
    start: string;
    end: string;
    timezone: string;
}>;
export declare const serviceCodeSchema: z.ZodEnum<["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"]>;
export declare const garmentPriceSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    priceMinor: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    priceMinor: number;
}, {
    id: string;
    name: string;
    priceMinor: number;
}>;
export declare const serviceSchema: z.ZodObject<{
    id: z.ZodString;
    code: z.ZodEnum<["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"]>;
    name: z.ZodString;
    description: z.ZodString;
    imageUrl: z.ZodString;
    priceMinor: z.ZodNumber;
    priceUnit: z.ZodString;
    turnaroundHours: z.ZodNumber;
    garments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceMinor: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        priceMinor: number;
    }, {
        id: string;
        name: string;
        priceMinor: number;
    }>, "many">;
    features: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    code: "WASH_FOLD" | "WASH_PRESS" | "PRESS_ONLY" | "DRY_CLEAN";
    id: string;
    name: string;
    priceMinor: number;
    description: string;
    imageUrl: string;
    priceUnit: string;
    turnaroundHours: number;
    garments: {
        id: string;
        name: string;
        priceMinor: number;
    }[];
    features: string[];
}, {
    code: "WASH_FOLD" | "WASH_PRESS" | "PRESS_ONLY" | "DRY_CLEAN";
    id: string;
    name: string;
    priceMinor: number;
    description: string;
    imageUrl: string;
    priceUnit: string;
    turnaroundHours: number;
    garments: {
        id: string;
        name: string;
        priceMinor: number;
    }[];
    features: string[];
}>;
export declare const requestedLineSchema: z.ZodObject<{
    serviceId: z.ZodString;
    garmentTypeId: z.ZodString;
    quantity: z.ZodNumber;
    estimatedWeightGrams: z.ZodOptional<z.ZodNumber>;
    careNotes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    serviceId: string;
    garmentTypeId: string;
    quantity: number;
    estimatedWeightGrams?: number | undefined;
    careNotes?: string | undefined;
}, {
    serviceId: string;
    garmentTypeId: string;
    quantity: number;
    estimatedWeightGrams?: number | undefined;
    careNotes?: string | undefined;
}>;
export declare const quoteInputSchema: z.ZodObject<{
    addressId: z.ZodString;
    lines: z.ZodArray<z.ZodObject<{
        serviceId: z.ZodString;
        garmentTypeId: z.ZodString;
        quantity: z.ZodNumber;
        estimatedWeightGrams: z.ZodOptional<z.ZodNumber>;
        careNotes: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }, {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }>, "many">;
    pickupWindow: z.ZodEffects<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>;
    requestedReturnBy: z.ZodString;
    timezone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timezone: string;
    addressId: string;
    lines: {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }[];
    pickupWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    requestedReturnBy: string;
}, {
    timezone: string;
    addressId: string;
    lines: {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }[];
    pickupWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    requestedReturnBy: string;
}>;
export declare const priceLineSchema: z.ZodObject<{
    label: z.ZodString;
    amountMinor: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    amountMinor: number;
    label: string;
}, {
    amountMinor: number;
    label: string;
}>;
export declare const quoteLineSchema: z.ZodObject<z.objectUtil.extendShape<{
    serviceId: z.ZodString;
    garmentTypeId: z.ZodString;
    quantity: z.ZodNumber;
    estimatedWeightGrams: z.ZodOptional<z.ZodNumber>;
    careNotes: z.ZodOptional<z.ZodString>;
}, {
    unitPriceMinor: z.ZodNumber;
    lineTotalMinor: z.ZodNumber;
}>, "strip", z.ZodTypeAny, {
    serviceId: string;
    garmentTypeId: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    estimatedWeightGrams?: number | undefined;
    careNotes?: string | undefined;
}, {
    serviceId: string;
    garmentTypeId: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    estimatedWeightGrams?: number | undefined;
    careNotes?: string | undefined;
}>;
export declare const quoteSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodNumber;
    expiresAt: z.ZodString;
    rateCardId: z.ZodOptional<z.ZodString>;
    rateCardVersion: z.ZodOptional<z.ZodNumber>;
    lines: z.ZodArray<z.ZodObject<z.objectUtil.extendShape<{
        serviceId: z.ZodString;
        garmentTypeId: z.ZodString;
        quantity: z.ZodNumber;
        estimatedWeightGrams: z.ZodOptional<z.ZodNumber>;
        careNotes: z.ZodOptional<z.ZodString>;
    }, {
        unitPriceMinor: z.ZodNumber;
        lineTotalMinor: z.ZodNumber;
    }>, "strip", z.ZodTypeAny, {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }, {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }>, "many">;
    totalMinor: z.ZodNumber;
    currency: z.ZodLiteral<"INR">;
    provisional: z.ZodBoolean;
    pickupWindow: z.ZodEffects<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>;
    promisedReturnWindow: z.ZodEffects<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>;
    breakdown: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        amountMinor: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        label: string;
    }, {
        amountMinor: number;
        label: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    currency: "INR";
    id: string;
    lines: {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }[];
    pickupWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    version: number;
    expiresAt: string;
    totalMinor: number;
    provisional: boolean;
    promisedReturnWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    breakdown: {
        amountMinor: number;
        label: string;
    }[];
    rateCardId?: string | undefined;
    rateCardVersion?: number | undefined;
}, {
    currency: "INR";
    id: string;
    lines: {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }[];
    pickupWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    version: number;
    expiresAt: string;
    totalMinor: number;
    provisional: boolean;
    promisedReturnWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    breakdown: {
        amountMinor: number;
        label: string;
    }[];
    rateCardId?: string | undefined;
    rateCardVersion?: number | undefined;
}>;
export declare const checkoutSchema: z.ZodObject<{
    orderId: z.ZodString;
    paymentId: z.ZodString;
    paymentUrl: z.ZodString;
    expiresAt: z.ZodString;
    status: z.ZodEnum<["AWAITING_PAYMENT", "RESOLUTION_REQUIRED"]>;
}, "strip", z.ZodTypeAny, {
    status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED";
    expiresAt: string;
    orderId: string;
    paymentId: string;
    paymentUrl: string;
}, {
    status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED";
    expiresAt: string;
    orderId: string;
    paymentId: string;
    paymentUrl: string;
}>;
export declare const orderStatusSchema: z.ZodEnum<["AWAITING_PAYMENT", "CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "AWAITING_ADJUSTMENT", "ON_HOLD", "RESOLUTION_REQUIRED", "CANCEL_REQUESTED", "CANCELLED"]>;
export declare const deliveryStatusSchema: z.ZodEnum<["REQUESTED", "BOOKING_UNKNOWN", "BOOKED", "ASSIGNED", "AT_PICKUP", "IN_TRANSIT", "COMPLETED", "FAILED", "CANCEL_REQUESTED", "CANCELLED"]>;
export declare const deliveryJobSchema: z.ZodObject<{
    id: z.ZodString;
    orderId: z.ZodString;
    leg: z.ZodEnum<["PICKUP", "RETURN"]>;
    status: z.ZodEnum<["REQUESTED", "BOOKING_UNKNOWN", "BOOKED", "ASSIGNED", "AT_PICKUP", "IN_TRANSIT", "COMPLETED", "FAILED", "CANCEL_REQUESTED", "CANCELLED"]>;
    version: z.ZodNumber;
    customerName: z.ZodString;
    address: z.ZodString;
    window: z.ZodEffects<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>;
    bagIds: z.ZodArray<z.ZodString, "many">;
    provider: z.ZodString;
    dispatchMode: z.ZodEnum<["PROVIDER", "MANUAL"]>;
    capabilities: z.ZodArray<z.ZodString, "many">;
    assignedTo: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "CANCEL_REQUESTED" | "CANCELLED" | "FAILED" | "REQUESTED" | "BOOKING_UNKNOWN" | "BOOKED" | "ASSIGNED" | "AT_PICKUP" | "IN_TRANSIT" | "COMPLETED";
    id: string;
    version: number;
    orderId: string;
    leg: "PICKUP" | "RETURN";
    customerName: string;
    address: string;
    window: {
        start: string;
        end: string;
        timezone: string;
    };
    bagIds: string[];
    provider: string;
    dispatchMode: "PROVIDER" | "MANUAL";
    capabilities: string[];
    assignedTo?: string | undefined;
}, {
    status: "CANCEL_REQUESTED" | "CANCELLED" | "FAILED" | "REQUESTED" | "BOOKING_UNKNOWN" | "BOOKED" | "ASSIGNED" | "AT_PICKUP" | "IN_TRANSIT" | "COMPLETED";
    id: string;
    version: number;
    orderId: string;
    leg: "PICKUP" | "RETURN";
    customerName: string;
    address: string;
    window: {
        start: string;
        end: string;
        timezone: string;
    };
    bagIds: string[];
    provider: string;
    dispatchMode: "PROVIDER" | "MANUAL";
    capabilities: string[];
    assignedTo?: string | undefined;
}>;
export declare const timelineEventSchema: z.ZodObject<{
    status: z.ZodEnum<["AWAITING_PAYMENT", "CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "AWAITING_ADJUSTMENT", "ON_HOLD", "RESOLUTION_REQUIRED", "CANCEL_REQUESTED", "CANCELLED"]>;
    label: z.ZodString;
    at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    at: string;
    status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
    label: string;
}, {
    at: string;
    status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
    label: string;
}>;
export declare const orderSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodNumber;
    status: z.ZodEnum<["AWAITING_PAYMENT", "CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "AWAITING_ADJUSTMENT", "ON_HOLD", "RESOLUTION_REQUIRED", "CANCEL_REQUESTED", "CANCELLED"]>;
    customerId: z.ZodString;
    facilityId: z.ZodOptional<z.ZodString>;
    lines: z.ZodArray<z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
        serviceId: z.ZodString;
        garmentTypeId: z.ZodString;
        quantity: z.ZodNumber;
        estimatedWeightGrams: z.ZodOptional<z.ZodNumber>;
        careNotes: z.ZodOptional<z.ZodString>;
    }, {
        unitPriceMinor: z.ZodNumber;
        lineTotalMinor: z.ZodNumber;
    }>, {
        orderLineId: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        orderLineId: string;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }, {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        orderLineId: string;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }>, "many">;
    totalMinor: z.ZodNumber;
    currency: z.ZodLiteral<"INR">;
    pickupWindow: z.ZodEffects<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>;
    promisedReturnWindow: z.ZodEffects<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>, {
        start: string;
        end: string;
        timezone: string;
    }, {
        start: string;
        end: string;
        timezone: string;
    }>;
    createdAt: z.ZodString;
    timeline: z.ZodArray<z.ZodObject<{
        status: z.ZodEnum<["AWAITING_PAYMENT", "CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "AWAITING_ADJUSTMENT", "ON_HOLD", "RESOLUTION_REQUIRED", "CANCEL_REQUESTED", "CANCELLED"]>;
        label: z.ZodString;
        at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        at: string;
        status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
        label: string;
    }, {
        at: string;
        status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
        label: string;
    }>, "many">;
    paymentStatus: z.ZodEnum<["CREATED", "PENDING", "CAPTURED", "FAILED", "EXPIRED"]>;
    adjustment: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        status: z.ZodString;
        deltaMinor: z.ZodNumber;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        status: string;
        id: string;
        deltaMinor: number;
        reason: string;
    }, {
        status: string;
        id: string;
        deltaMinor: number;
        reason: string;
    }>>;
    deliveries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        orderId: z.ZodString;
        leg: z.ZodEnum<["PICKUP", "RETURN"]>;
        status: z.ZodEnum<["REQUESTED", "BOOKING_UNKNOWN", "BOOKED", "ASSIGNED", "AT_PICKUP", "IN_TRANSIT", "COMPLETED", "FAILED", "CANCEL_REQUESTED", "CANCELLED"]>;
        version: z.ZodNumber;
        customerName: z.ZodString;
        address: z.ZodString;
        window: z.ZodEffects<z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
            timezone: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            start: string;
            end: string;
            timezone: string;
        }, {
            start: string;
            end: string;
            timezone: string;
        }>, {
            start: string;
            end: string;
            timezone: string;
        }, {
            start: string;
            end: string;
            timezone: string;
        }>;
        bagIds: z.ZodArray<z.ZodString, "many">;
        provider: z.ZodString;
        dispatchMode: z.ZodEnum<["PROVIDER", "MANUAL"]>;
        capabilities: z.ZodArray<z.ZodString, "many">;
        assignedTo: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "CANCEL_REQUESTED" | "CANCELLED" | "FAILED" | "REQUESTED" | "BOOKING_UNKNOWN" | "BOOKED" | "ASSIGNED" | "AT_PICKUP" | "IN_TRANSIT" | "COMPLETED";
        id: string;
        version: number;
        orderId: string;
        leg: "PICKUP" | "RETURN";
        customerName: string;
        address: string;
        window: {
            start: string;
            end: string;
            timezone: string;
        };
        bagIds: string[];
        provider: string;
        dispatchMode: "PROVIDER" | "MANUAL";
        capabilities: string[];
        assignedTo?: string | undefined;
    }, {
        status: "CANCEL_REQUESTED" | "CANCELLED" | "FAILED" | "REQUESTED" | "BOOKING_UNKNOWN" | "BOOKED" | "ASSIGNED" | "AT_PICKUP" | "IN_TRANSIT" | "COMPLETED";
        id: string;
        version: number;
        orderId: string;
        leg: "PICKUP" | "RETURN";
        customerName: string;
        address: string;
        window: {
            start: string;
            end: string;
            timezone: string;
        };
        bagIds: string[];
        provider: string;
        dispatchMode: "PROVIDER" | "MANUAL";
        capabilities: string[];
        assignedTo?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    currency: "INR";
    status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
    id: string;
    lines: {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        orderLineId: string;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }[];
    pickupWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    version: number;
    totalMinor: number;
    promisedReturnWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    customerId: string;
    createdAt: string;
    timeline: {
        at: string;
        status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
        label: string;
    }[];
    paymentStatus: "CREATED" | "PENDING" | "CAPTURED" | "FAILED" | "EXPIRED";
    deliveries: {
        status: "CANCEL_REQUESTED" | "CANCELLED" | "FAILED" | "REQUESTED" | "BOOKING_UNKNOWN" | "BOOKED" | "ASSIGNED" | "AT_PICKUP" | "IN_TRANSIT" | "COMPLETED";
        id: string;
        version: number;
        orderId: string;
        leg: "PICKUP" | "RETURN";
        customerName: string;
        address: string;
        window: {
            start: string;
            end: string;
            timezone: string;
        };
        bagIds: string[];
        provider: string;
        dispatchMode: "PROVIDER" | "MANUAL";
        capabilities: string[];
        assignedTo?: string | undefined;
    }[];
    facilityId?: string | undefined;
    adjustment?: {
        status: string;
        id: string;
        deltaMinor: number;
        reason: string;
    } | undefined;
}, {
    currency: "INR";
    status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
    id: string;
    lines: {
        serviceId: string;
        garmentTypeId: string;
        quantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        orderLineId: string;
        estimatedWeightGrams?: number | undefined;
        careNotes?: string | undefined;
    }[];
    pickupWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    version: number;
    totalMinor: number;
    promisedReturnWindow: {
        start: string;
        end: string;
        timezone: string;
    };
    customerId: string;
    createdAt: string;
    timeline: {
        at: string;
        status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" | "CONFIRMED" | "PICKUP_PENDING" | "AT_FACILITY" | "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN" | "RETURNING" | "DELIVERED" | "AWAITING_ADJUSTMENT" | "ON_HOLD" | "CANCEL_REQUESTED" | "CANCELLED";
        label: string;
    }[];
    paymentStatus: "CREATED" | "PENDING" | "CAPTURED" | "FAILED" | "EXPIRED";
    deliveries: {
        status: "CANCEL_REQUESTED" | "CANCELLED" | "FAILED" | "REQUESTED" | "BOOKING_UNKNOWN" | "BOOKED" | "ASSIGNED" | "AT_PICKUP" | "IN_TRANSIT" | "COMPLETED";
        id: string;
        version: number;
        orderId: string;
        leg: "PICKUP" | "RETURN";
        customerName: string;
        address: string;
        window: {
            start: string;
            end: string;
            timezone: string;
        };
        bagIds: string[];
        provider: string;
        dispatchMode: "PROVIDER" | "MANUAL";
        capabilities: string[];
        assignedTo?: string | undefined;
    }[];
    facilityId?: string | undefined;
    adjustment?: {
        status: string;
        id: string;
        deltaMinor: number;
        reason: string;
    } | undefined;
}>;
export declare const handoverInputSchema: z.ZodObject<{
    jobId: z.ZodString;
    actionId: z.ZodString;
    bagIds: z.ZodArray<z.ZodString, "many">;
    method: z.ZodEnum<["OTP", "PROVIDER_PROOF", "OPERATOR_EXCEPTION"]>;
    proofReference: z.ZodOptional<z.ZodString>;
    otp: z.ZodOptional<z.ZodString>;
    capturedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    bagIds: string[];
    jobId: string;
    actionId: string;
    method: "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION";
    capturedAt: string;
    proofReference?: string | undefined;
    otp?: string | undefined;
}, {
    bagIds: string[];
    jobId: string;
    actionId: string;
    method: "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION";
    capturedAt: string;
    proofReference?: string | undefined;
    otp?: string | undefined;
}>;
export declare const addressSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodNumber;
    ownerId: z.ZodString;
    label: z.ZodString;
    line1: z.ZodString;
    city: z.ZodString;
    postalCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    label: string;
    version: number;
    ownerId: string;
    line1: string;
    city: string;
    postalCode: string;
}, {
    id: string;
    label: string;
    version: number;
    ownerId: string;
    line1: string;
    city: string;
    postalCode: string;
}>;
export declare const otpRequestSchema: z.ZodObject<{
    phone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    phone: string;
}, {
    phone: string;
}>;
export declare const otpVerifySchema: z.ZodObject<{
    challengeId: z.ZodString;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    challengeId: string;
}, {
    code: string;
    challengeId: string;
}>;
export declare const demoAuthSchema: z.ZodObject<{
    role: z.ZodEnum<["customer", "rider", "operator"]>;
}, "strip", z.ZodTypeAny, {
    role: "customer" | "rider" | "operator";
}, {
    role: "customer" | "rider" | "operator";
}>;
export declare const sessionSchema: z.ZodObject<{
    token: z.ZodString;
    user: z.ZodObject<{
        id: z.ZodString;
        role: z.ZodString;
        name: z.ZodString;
        phone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        phone: string;
        role: string;
    }, {
        id: string;
        name: string;
        phone: string;
        role: string;
    }>;
}, "strip", z.ZodTypeAny, {
    token: string;
    user: {
        id: string;
        name: string;
        phone: string;
        role: string;
    };
}, {
    token: string;
    user: {
        id: string;
        name: string;
        phone: string;
        role: string;
    };
}>;
export declare const errorEnvelopeSchema: z.ZodObject<{
    code: z.ZodEnum<["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT", "OUT_OF_AREA", "NO_CAPACITY", "DEADLINE_UNAVAILABLE", "QUOTE_EXPIRED", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "PAYMENT_PENDING", "PROVIDER_UNAVAILABLE", "PROVIDER_OUTCOME_UNKNOWN", "REQUIRES_APPROVAL", "RATE_LIMITED"]>;
    message: z.ZodString;
    traceId: z.ZodString;
    retryable: z.ZodBoolean;
    fieldErrors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "OUT_OF_AREA" | "NO_CAPACITY" | "DEADLINE_UNAVAILABLE" | "QUOTE_EXPIRED" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "PAYMENT_PENDING" | "PROVIDER_UNAVAILABLE" | "PROVIDER_OUTCOME_UNKNOWN" | "REQUIRES_APPROVAL" | "RATE_LIMITED";
    message: string;
    traceId: string;
    retryable: boolean;
    fieldErrors?: Record<string, string> | undefined;
}, {
    code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "OUT_OF_AREA" | "NO_CAPACITY" | "DEADLINE_UNAVAILABLE" | "QUOTE_EXPIRED" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "PAYMENT_PENDING" | "PROVIDER_UNAVAILABLE" | "PROVIDER_OUTCOME_UNKNOWN" | "REQUIRES_APPROVAL" | "RATE_LIMITED";
    message: string;
    traceId: string;
    retryable: boolean;
    fieldErrors?: Record<string, string> | undefined;
}>;
export declare const reviewInputSchema: z.ZodObject<{
    orderId: z.ZodString;
    overall: z.ZodNumber;
    serviceScore: z.ZodOptional<z.ZodNumber>;
    deliveryScore: z.ZodOptional<z.ZodNumber>;
    comment: z.ZodOptional<z.ZodString>;
    mediaIds: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    publishConsent: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    overall: number;
    mediaIds: string[];
    publishConsent: boolean;
    serviceScore?: number | undefined;
    deliveryScore?: number | undefined;
    comment?: string | undefined;
}, {
    orderId: string;
    overall: number;
    publishConsent: boolean;
    serviceScore?: number | undefined;
    deliveryScore?: number | undefined;
    comment?: string | undefined;
    mediaIds?: string[] | undefined;
}>;
export declare const cancelOrderSchema: z.ZodObject<{
    reason: z.ZodString;
    expectedVersion: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    reason: string;
    expectedVersion: number;
}, {
    reason: string;
    expectedVersion: number;
}>;
export declare const conversationMessageSchema: z.ZodObject<{
    text: z.ZodString;
    receivedAt: z.ZodOptional<z.ZodString>;
    draftId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    text: string;
    receivedAt?: string | undefined;
    draftId?: string | undefined;
}, {
    text: string;
    receivedAt?: string | undefined;
    draftId?: string | undefined;
}>;
export declare const draftConfirmSchema: z.ZodObject<{
    draftId: z.ZodString;
    revision: z.ZodNumber;
    quoteId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    draftId: string;
    revision: number;
    quoteId: string;
}, {
    draftId: string;
    revision: number;
    quoteId: string;
}>;
//# sourceMappingURL=schemas.d.ts.map